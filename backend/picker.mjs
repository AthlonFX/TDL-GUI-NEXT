import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class FolderPickers {
  constructor(executable, launch = null) {
    this.useResultFile = !launch;
    this.launch = launch || ((initial, resultFile) => spawn(executable, [initial || '', resultFile], { windowsHide: false, stdio: 'ignore' }));
    this.items = new Map();
    this.current = null;
  }
  view(item) { return { id: item.id, status: item.status, directory: item.directory || null, error: item.error || '' }; }
  get(id) { const item = this.items.get(id); if (!item) throw new Error('选择窗口已结束，请重新选择'); return this.view(item); }
  start(initial) {
    const previous = this.current;
    if (previous?.status === 'opening' && previous.child?.exitCode === null && !previous.child.killed) return this.view(previous);
    const item = { id: crypto.randomUUID(), status: 'opening', directory: null, child: null, timer: null };
    this.current = item; this.items.set(item.id, item);
    if (this.items.size > 20) this.items.delete(this.items.keys().next().value);
    try {
      const resultFile = this.useResultFile ? path.join(os.tmpdir(), `tdl-folder-${item.id}.txt`) : null;
      const child = this.launch(initial, resultFile); item.child = child;
      let output = '', errors = '';
      child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', chunk => { output += chunk; }); child.stderr?.on('data', chunk => { errors += chunk; });
      const finish = (status, error) => {
        if (item.status !== 'opening') return;
        clearTimeout(item.timer); item.status = status; item.error = error || '';
        if (this.current === item) this.current = null;
      };
      child.once('error', error => finish('failed', `无法打开 Windows 文件夹窗口：${error.message}`));
      child.once('close', code => {
        if (resultFile) {
          try { const result = fs.readFileSync(resultFile, 'utf8'); if(code===0)output=result;else errors=result; } catch {}
          try { fs.unlinkSync(resultFile); } catch {}
        }
        item.directory = code === 0 ? output.trim() || null : null;
        finish(code === 2 || (code === 0 && !item.directory) ? 'cancelled' : code === 0 ? 'selected' : 'failed', code && code !== 2 ? errors || '选择窗口意外关闭，请重新选择' : '');
      });
      item.timer = setTimeout(() => {
        finish('cancelled', '选择窗口已超时，可以重新打开'); child.kill();
      }, 3 * 60 * 1000);
      item.timer.unref();
    } catch (error) { item.status = 'failed'; item.error = error.message; this.current = null; }
    return this.view(item);
  }
  cancel(id) {
    const item = this.items.get(id);
    if (item?.status === 'opening') {
      item.status = 'cancelled'; clearTimeout(item.timer); item.child?.kill();
      if (this.current === item) this.current = null;
    }
    return this.get(id);
  }
  close() { if (this.current) this.cancel(this.current.id); }
}
