import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const build=path.join(root,'dist','win-unpacked');
const output=path.join(root,'release');
if(process.platform!=='win32')throw new Error('本脚本打包 Windows 构建，请在 Windows 上运行。');
if(!fs.existsSync(path.join(build,'TDL-GUI-NEXT.exe')))throw new Error('请先运行 npm run build。');
function inspect(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isSymbolicLink())throw new Error('构建目录不应含符号链接');const relative=path.relative(build,path.join(dir,item.name)).replaceAll('\\','/');if(/(^|\/)(cache|data|downloads|logs|\.tdl|tdl-thumbnail-cache)(\/|$)/i.test(relative)||/^(settings\.json|desktop-service\.json|accounts\.json|tasks\.json)$/i.test(item.name))throw new Error('构建目录含本地数据：'+relative);if(item.isDirectory())inspect(path.join(dir,item.name));}}
inspect(build);
const migration=JSON.parse(fs.readFileSync(path.join(build,'resources/migration-source.json'),'utf8'));if(migration.path)throw new Error('发布包不应包含个人迁移路径');
fs.mkdirSync(output,{recursive:true});
const filename=`TDL-GUI-NEXT-${version}-Windows-x64.zip`,destination=path.join(output,filename);
if(fs.existsSync(destination))throw new Error('输出文件已存在，请先检查，避免覆盖。');
const script="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:TDL_RELEASE_ZIP_INPUT,$env:TDL_RELEASE_ZIP_OUTPUT,[IO.Compression.CompressionLevel]::Optimal,$true,[Text.Encoding]::UTF8)";
const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{stdio:'inherit',windowsHide:true,env:{...process.env,TDL_RELEASE_ZIP_INPUT:build,TDL_RELEASE_ZIP_OUTPUT:destination}});
if(result.error)throw result.error;if(result.status!==0)throw new Error('ZIP 打包失败');
const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(destination))hash.update(chunk);
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),`${hash.digest('hex')}  ${filename}\n`);
console.log('已生成免安装 ZIP 和 SHA256SUMS.txt；未上传 GitHub。请保留并审核全部第三方许可及对应源码材料。');
