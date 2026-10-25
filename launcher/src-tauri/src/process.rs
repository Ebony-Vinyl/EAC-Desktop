use crate::{
    files::{self, text},
    model::{new_id, OwnedProcess, Result},
};
use std::{
    fs::OpenOptions,
    path::Path,
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};
#[cfg(unix)]
use sysinfo::{Pid, ProcessesToUpdate, System};

pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    command.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

fn identity(pid: u32) -> Option<(u64, String)> {
    #[cfg(windows)]
    {
        return platform::identity(pid);
    }
    #[cfg(unix)]
    {
        let pid = Pid::from_u32(pid);
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        let process = system.process(pid)?;
        let executable = process
            .exe()
            .and_then(|path| files::canonical(path).ok())
            .map(|path| text(&path))
            .unwrap_or_default();
        Some((process.start_time(), executable))
    }
}

pub fn alive(record: &OwnedProcess) -> bool {
    identity(record.pid).is_some_and(|(start, exe)| {
        start == record.start_time
            && (exe.is_empty() || exe.eq_ignore_ascii_case(&record.executable))
    })
}

pub fn tree_alive(record: &OwnedProcess) -> bool {
    platform::tree_alive(record)
}

pub fn desktop_window_ready(record: &OwnedProcess) -> bool {
    platform::desktop_window_ready(record)
}

pub fn spawn(mut command: Command, log: &Path) -> Result<(Child, OwnedProcess)> {
    let output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| e.to_string())?;
    command.stdout(output.try_clone().map_err(|e| e.to_string())?);
    command.stderr(output);
    platform::configure(&mut command);
    let expected_executable = files::canonical(Path::new(command.get_program()))
        .map(|path| text(&path))
        .unwrap_or_else(|_| text(Path::new(command.get_program())));
    let mut child = command.spawn().map_err(|e| format!("Start process: {e}"))?;
    let job = format!("EACLauncher-{}", new_id());
    if let Err(error) = platform::attach(&child, &job) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    let observed = loop {
        if let Some(identity) = identity(child.id()) {
            break Some(identity);
        }
        if Instant::now() >= deadline {
            break None;
        }
        thread::sleep(Duration::from_millis(50));
    };
    let Some((start_time, executable)) = observed else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Process exited before its identity could be recorded; inspect logs".into());
    };
    let pid = child.id();
    Ok((
        child,
        OwnedProcess {
            pid,
            start_time,
            executable: if executable.is_empty() {
                expected_executable
            } else {
                executable
            },
            job,
        },
    ))
}

pub fn stop(record: &OwnedProcess) -> Result<()> {
    platform::terminate(record)?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while tree_alive(record) {
        if Instant::now() > deadline {
            return Err("Owned process tree did not exit within 15 seconds".into());
        }
        thread::sleep(Duration::from_millis(100));
    }
    Ok(())
}

pub fn run(command: Command, log: &Path, timeout: Duration) -> Result<()> {
    let (mut child, record) = spawn(command, log)?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                // Lifecycle scripts must not keep running after the CLI returned.
                if tree_alive(&record) {
                    stop(&record)?;
                }
                if status.success() {
                    return Ok(());
                }
                return Err(format!(
                    "Process exited with {status}. Log: {}\n{}",
                    log.display(),
                    tail(log, 24 * 1024)?
                ));
            }
            None if start.elapsed() > timeout => {
                let stopped = stop(&record);
                return Err(format!(
                    "Operation timed out after {}s; tree cleanup: {}. Log: {}",
                    timeout.as_secs(),
                    stopped.err().unwrap_or_else(|| "completed".into()),
                    log.display()
                ));
            }
            None => thread::sleep(Duration::from_millis(100)),
        }
    }
}

pub fn tail(path: &Path, limit: u64) -> Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    if !path.exists() {
        return Ok(String::new());
    }
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    file.seek(SeekFrom::Start(size.saturating_sub(limit)))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{
        mem,
        os::{windows::ffi::OsStringExt, windows::io::AsRawHandle},
        path::PathBuf,
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GetLastError, FILETIME, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE,
        },
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
                THREADENTRY32,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
                JobObjectBasicAccountingInformation, OpenJobObjectW, QueryInformationJobObject,
                TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            },
            Threading::{
                GetExitCodeProcess, GetProcessTimes, OpenProcess, OpenThread,
                QueryFullProcessImageNameW, ResumeThread, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION, THREAD_SUSPEND_RESUME,
            },
        },
    };

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    pub fn identity(pid: u32) -> Option<(u64, String)> {
        let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if raw.is_null() {
            return None;
        }
        let handle = Handle(raw);
        let mut exit_code = 0;
        if unsafe { GetExitCodeProcess(handle.0, &mut exit_code) } == 0
            || exit_code != STILL_ACTIVE as u32
        {
            return None;
        }
        let mut created: FILETIME = unsafe { mem::zeroed() };
        let mut exited: FILETIME = unsafe { mem::zeroed() };
        let mut kernel: FILETIME = unsafe { mem::zeroed() };
        let mut user: FILETIME = unsafe { mem::zeroed() };
        if unsafe { GetProcessTimes(handle.0, &mut created, &mut exited, &mut kernel, &mut user) }
            == 0
        {
            return None;
        }
        let start_time =
            (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        let mut buffer = [0u16; 32768];
        let mut length = buffer.len() as u32;
        let executable = if unsafe {
            QueryFullProcessImageNameW(
                handle.0,
                PROCESS_NAME_WIN32,
                buffer.as_mut_ptr(),
                &mut length,
            )
        } != 0
        {
            files::canonical(
                PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize])).as_path(),
            )
            .map(|path| text(&path))
            .unwrap_or_default()
        } else {
            String::new()
        };
        Some((start_time, executable))
    }

    fn name(value: &str) -> Result<Vec<u16>> {
        let suffix = value
            .strip_prefix("EACLauncher-")
            .ok_or("Invalid job name")?;
        files::valid_id(suffix)?;
        Ok(format!("Local\\{value}")
            .encode_utf16()
            .chain([0])
            .collect())
    }

    fn open(record: &OwnedProcess, access: u32) -> Result<Option<Handle>> {
        let wide = name(&record.job)?;
        let raw = unsafe { OpenJobObjectW(access, 0, wide.as_ptr()) };
        if raw.is_null() {
            let error = std::io::Error::last_os_error();
            return match error.raw_os_error() {
                Some(2) => Ok(None),
                _ => Err(format!("Open owned job: {error}")),
            };
        }
        Ok(Some(Handle(raw)))
    }

    pub fn configure(command: &mut Command) {
        use std::os::windows::process::CommandExt;
        // Assignment happens before any child code can create an unowned descendant.
        command.creation_flags(0x08000000 | 0x00000004);
    }

    pub fn attach(child: &Child, job: &str) -> Result<()> {
        let wide = name(job)?;
        let raw = unsafe { CreateJobObjectW(ptr::null(), wide.as_ptr()) };
        if raw.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let handle = Handle(raw);
        if unsafe { GetLastError() } == 183 {
            return Err("Process job name collision".into());
        }
        if unsafe { AssignProcessToJobObject(handle.0, child.as_raw_handle() as HANDLE) } == 0 {
            return Err(format!(
                "Assign isolated process job: {}",
                std::io::Error::last_os_error()
            ));
        }
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let snapshot = Handle(snapshot);
        let mut entry: THREADENTRY32 = unsafe { mem::zeroed() };
        entry.dwSize = mem::size_of::<THREADENTRY32>() as u32;
        let mut found = false;
        let mut next = unsafe { Thread32First(snapshot.0, &mut entry) };
        while next != 0 {
            if entry.th32OwnerProcessID == child.id() {
                let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
                if thread.is_null() {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                let thread = Handle(thread);
                if unsafe { ResumeThread(thread.0) } == u32::MAX {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                found = true;
            }
            next = unsafe { Thread32Next(snapshot.0, &mut entry) };
        }
        if !found {
            return Err("Cannot resume isolated process".into());
        }
        // Named jobs live while any member lives. No kill-on-close: CLI launch survives its caller.
        Ok(())
    }

    pub fn belongs(record: &OwnedProcess) -> bool {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let Ok(Some(job)) = open(record, 0x0004) else {
            return false;
        };
        let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, record.pid) };
        if raw.is_null() {
            return false;
        }
        let process = Handle(raw);
        let mut belongs = 0;
        unsafe { IsProcessInJob(process.0, job.0, &mut belongs) != 0 && belongs != 0 }
    }

    pub fn desktop_window_ready(record: &OwnedProcess) -> bool {
        use windows_sys::Win32::{
            Foundation::{BOOL, HWND, LPARAM},
            UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible},
        };
        struct Search<'a> {
            record: &'a OwnedProcess,
            ready: bool,
        }
        unsafe extern "system" fn visit(window: HWND, context: LPARAM) -> BOOL {
            let search = &mut *(context as *mut Search<'_>);
            if IsWindowVisible(window) == 0 {
                return 1;
            }
            let mut pid = 0;
            GetWindowThreadProcessId(window, &mut pid);
            let mut candidate = search.record.clone();
            candidate.pid = pid;
            if pid == search.record.pid || belongs(&candidate) {
                search.ready = true;
                return 0;
            }
            1
        }
        let mut search = Search {
            record,
            ready: false,
        };
        unsafe {
            EnumWindows(Some(visit), &mut search as *mut _ as isize);
        }
        search.ready
    }

    pub fn tree_alive(record: &OwnedProcess) -> bool {
        let Ok(Some(job)) = open(record, 0x0004) else {
            return super::alive(record);
        };
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { mem::zeroed() };
        unsafe {
            QueryInformationJobObject(
                job.0,
                JobObjectBasicAccountingInformation,
                &mut accounting as *mut _ as *mut _,
                mem::size_of_val(&accounting) as u32,
                ptr::null_mut(),
            ) != 0
                && accounting.ActiveProcesses > 0
        }
    }

    pub fn terminate(record: &OwnedProcess) -> Result<()> {
        let Some(job) = open(record, 0x0008 | 0x0004)? else {
            if super::alive(record) {
                let status = super::command("taskkill.exe")
                    .args(["/PID", &record.pid.to_string(), "/T", "/F"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(|e| format!("Stop owned process tree: {e}"))?;
                if !status.success() {
                    return Err(format!("taskkill failed with {status}"));
                }
            }
            return Ok(());
        };
        // A named job can only contain processes assigned by this launcher.
        if unsafe { TerminateJobObject(job.0, 1) } == 0 {
            return Err(format!(
                "Stop owned job: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    pub fn configure(command: &mut Command) {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    pub fn attach(_: &Child, _: &str) -> Result<()> {
        Ok(())
    }
    pub fn belongs(record: &OwnedProcess) -> bool {
        unsafe { libc::getpgid(record.pid as i32) == record.pid as i32 }
    }
    pub fn tree_alive(record: &OwnedProcess) -> bool {
        super::alive(record)
    }
    pub fn desktop_window_ready(_: &OwnedProcess) -> bool {
        false
    }
    pub fn terminate(record: &OwnedProcess) -> Result<()> {
        if !super::alive(record) {
            return Ok(());
        }
        if unsafe { libc::kill(-(record.pid as i32), libc::SIGKILL) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
}
