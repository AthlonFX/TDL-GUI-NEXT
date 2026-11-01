import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32'||process.arch!=='x64')throw new Error('当前构建脚本面向 Windows x64。');
for(const file of ['runtime/node.exe','runtime/tdl.exe','runtime/NODE-LICENSE.txt','runtime/TDL-LICENSE.txt','backend/vendor/ffmpeg/ffmpeg.exe','backend/node_modules/node-pty/package.json','node_modules/electron/package.json']){
  if(!fs.existsSync(path.join(root,file)))throw new Error(`缺少 ${file}，请按 BUILD.md 准备构建环境。`);
}
const windir=process.env.SystemRoot||'C:\\Windows';
const csc=['Framework64','Framework'].map(folder=>path.join(windir,'Microsoft.NET',folder,'v4.0.30319','csc.exe')).find(filename=>fs.existsSync(filename));
if(!csc)throw new Error('找不到 .NET Framework C# 编译器，请准备 Windows 构建环境。');
const result=spawnSync(csc,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/out:'+path.join(root,'backend/FolderPicker.exe'),path.join(root,'native/FolderPicker.cs')],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;
if(result.status!==0)throw new Error('原生文件夹选择器编译失败。');
console.log('构建文件已准备，原生文件夹选择器编译成功。');
