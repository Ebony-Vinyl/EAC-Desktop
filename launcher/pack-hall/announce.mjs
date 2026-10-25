#!/usr/bin/env node
// 发布公告：node announce.mjs --server http://144.126.133.165:4317 --token <ANNOUNCE_TOKEN> --title "标题" 公告.html
// 公告文件是 HTML 片段（启动器端会做白名单净化：script/iframe 等会被移除，内联 style 保留用于美化）。
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const read = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : "";
};
const server = read("server") || "http://144.126.133.165:4317";
const token = read("token");
const title = read("title");
const file = args.find((value) => !value.startsWith("--") && !args[args.indexOf(value) - 1]?.startsWith("--"));
if (!token || !title || !file) {
  console.error("用法: node announce.mjs --token <TOKEN> --title \"公告标题\" [公告.html] [--server URL]");
  process.exit(1);
}
const html = readFileSync(file, "utf8");
const response = await fetch(`${server.replace(/\/+$/, "")}/api/announcement`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ title, html }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || !body.ok) {
  console.error(`发布失败 (HTTP ${response.status}):`, body.error ?? "");
  process.exit(1);
}
console.log(`已发布：${title}（${body.id}）→ ${server}`);
