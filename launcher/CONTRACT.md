# EAC Launcher implementation contract

New independent application under `launcher/`. Preserve all existing desktop work.
No commit, push, publication, PR creation, or release automation.
The UI is TypeScript/React; Tauri 2/Rust owns all real state and operations.
No fake installed instances, invented compatibility, install counts, ratings,
release dates, sizes, progress, or successful actions.

## Transport

Frontend calls `invoke('launcher_call', {action, payload})`.
Return JSON, reject with a human readable error on failure.
For browser QA use a local authenticated HTTP bridge to this same Rust engine,
not a fake frontend backend. A CLI `--api ACTION JSON` is useful for integration.

## Snapshot

`snapshot` returns:

```json
{
  "root": "absolute application data root",
  "platform": "windows",
  "instances": [],
  "kernels": [],
  "tasks": [],
  "settings": {"theme":"system","reducedMotion":false,"githubClientId":""},
  "social": {"authenticated":false,"profile":null,"likedPlugins":[]},
  "achievements": {"total":29,"unlockedCount":0,"points":0,"maxPoints":940,"streak":0,"bestStreak":0,"days":0,"opens":0,"unlocked":{}}
}
```

Instance: `{id,name,kind,kernelId,port,home,workspace,plugins,createdAt,status,pid?,url?,executable?}`.
kind: `harness`, `eac-desktop`, `official-desktop`.
status: `stopped`, `starting`, `running`, `error`.
Plugin: `{id,name,version,enabled,source,coreRange?}`.
Kernel: `{id,version,path,nodePath,cliPath,installedAt,source}`.
Task: `{id,label,status,progress,message,timestamp}`.
Task status: `running`, `completed`, `failed`, `cancelled`.

## Actions

- `create_instance`: `{name,kind,kernelId?,port?,workspace?,executable?}` -> snapshot
- `update_instance`: `{id,name?,kernelId?,workspace?,port?,executable?}` -> snapshot
- `clone_instance`: `{id,name}` -> snapshot; independent home, never shared mutable profile
- `delete_instance`: `{id}` -> snapshot; reject running instances; retain recoverable data
- `register_kernel`: `{directory}` -> snapshot; validate actual DSH package and bin
- `install_kernel`: `{version}` -> snapshot; exact npm version in isolated immutable directory
- `remove_kernel`: `{id}` -> snapshot; reject if referenced
- `launch_instance`: `{id}` -> snapshot; real process and readiness; isolated DSH_HOME, assigned port
- `stop_instance`: `{id}` -> snapshot; kill owned process tree only
- `instance_logs`: `{id}` -> `{text}`
- `install_plugin`: `{instanceId,ref,expectedSha256?}` -> snapshot; use official plugin CLI
- `remove_plugin`: `{instanceId,name}` -> snapshot; use official CLI
- `toggle_plugin`: `{instanceId,name,enabled}` -> snapshot; official profile bundle writer, stopped instance only
- `snapshot_instance`: `{id}` -> snapshot; stopped instance, backup real home/profile
- `restore_instance`: `{id,backupId}` -> snapshot; stopped instance, validate paths
- `list_backups`: `{id}` -> `{backups:[{id,createdAt,path}]}`
- `export_instance`: `{id,destination}` -> `{path}`; no credentials; portable descriptor
- `import_instance`: `{path}` -> snapshot; validate descriptor, new ID/home
- `save_settings`: `{theme?,reducedMotion?,githubClientId?}` -> snapshot
- `open_path`: `{path}` -> `{ok:true}`; managed root paths only
- `catalog`: `{}` -> catalog JSON from shipped `resources/catalog.json`
- `releases`: `{source:"eac"|"official"|"kernel"}` -> `{releases:[{tag,prerelease,publishedAt,body,assets:[{name,url,size,sha256?}]}]}`
- `download_asset`: `{url,filename,sha256?}` -> `{path,sha256,size}` verified bytes in cache
- `install_desktop`: `{kind,name,url,filename,sha256?}` -> snapshot; portable ZIP only, validated extraction, locate executable
- `kernel_versions`: `{}` -> `{versions:[string],tags:{}}` official npm metadata
- `github_status`: `{}` -> `{authenticated,profile?,scopes?,clientConfigured,likedPlugins}`; cached profile only
- `github_refresh`: `{}` -> status; revalidate token, clear it on HTTP 401
- `github_logout`: `{}` -> status; remove local credentials
- `github_login_start`: `{}` -> `{userCode,verificationUri,expiresIn,interval}`; requires an OAuth App Client ID with Device Flow enabled
- `github_login_poll`: `{}` -> `{status:"pending"|"authorized"|"expired"|"denied",profile?,scopes?,interval?}`; never returns the device code or token
- `github_login_token`: `{token}` -> `{status:"authorized",profile,scopes}`; validates the token against GitHub before storing it
- `github_star`: `{repo:"owner/repo",starred:boolean}` -> `{starred,repo,newlyUnlocked}`; GitHub API write, token never leaves Rust
- `github_starred`: `{}` -> `{repos:[string]}`; first 300 starred repositories, cached briefly
- `market_like`: `{pluginId,liked}` -> `{liked,pluginId,likes,newlyUnlocked}`; requires a GitHub login, local per-account record
- `market_download`: `{pluginId}` -> `{pluginId,downloads:{day,week,month},newlyUnlocked}`; only after a real successful install
- `market_stats`: `{}` -> local real install/like counts for day/week/month fallback
- `achievements`: `{}` -> `{definitions:[{id,name,description,category,tier,icon,target,current,points,hidden,unlockedAt}],summary,today}`
- `record_event`: `{event,value?}` -> `{newlyUnlocked,achievements}`; only non-engine UI events (`pack_published`, `pack_imported`, `market_search`, `ranking_viewed`)
- `usage_profile`: `{refresh?:boolean}` -> `{totals,today,week,month,heatmap,recent,models,providers,roots,sessions,turns,steps,activeDays,currentStreak,longestStreak,avgSpeed,firstAt,lastAt}`
  Parses real DSH session logs (`session.v4.jsonl.zstd`, concatenated zstd frames), only
  `assistant/message.usage`, model/provider and step timing. No message content is returned.

## Catalog

`{updatedAt,sources:[{id,name,url,description}],plugins:[{id,name,version,description,source,ref?,sha256?,coreRange?,license?,category?,installable:boolean}],packs:[{id,name,description,source,kernelVersion?,plugins:[{ref,sha256?}]}]}`
Missing/unknown compatibility must say unknown. Source links must be usable.
Install packs by creating an isolated instance with a selected installed kernel
then sequential official CLI installations, recording real partial failure.

## Non-negotiable behavior

No home/profile global sharing. No implicit automatic kernel upgrade. No overwriting
the old kernel. A switch cannot alter another instance. No shell interpolation of
user input. Validate names, IDs, traversal, symlink escapes, URLs, archive paths.
Do not serialize locks around long work so polling remains responsive.
No use of user's daily DSH home in tests.
Use exact error/status, cancellation, progress from real work; never timer success.
First screen is the launcher itself: selected instance and launch controls,
pixel visual motif and lively but restrained motion. Sidebar, themes, keyboard,
responsive layouts, meaningful empty states, no landing page or marketing hero.

GitHub credentials live only in the launcher data root (`github.json`, 0600 on Unix);
they are never included in snapshots, task messages, logs, usage responses or hall
requests. Star writes happen only on an explicit user click. Plugin likes require a
logged-in account locally, while the hall only receives an anonymous client identifier
for deduplication. Download rankings must label `hall` vs `local`; no counts are invented.
Usage parsing is read-only, stays on the machine, and never returns message content.
