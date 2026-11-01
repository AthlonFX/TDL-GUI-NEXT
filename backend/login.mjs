import crypto from 'node:crypto';
import pty from 'node-pty';
import headless from '@xterm/headless';

export function qrFromTerminal(lines) {
  for (let row = 0; row < lines.length; row++) {
    const border = lines[row].match(/^█{29,85}/);
    if (!border) continue;
    const width = border[0].length;
    const height = Math.ceil(width / 2);
    if (row + height > lines.length) continue;
    const cells = lines.slice(row, row + height).map(line => line.slice(0, width));
    if (cells.some(line => line.length !== width || /[^ ▀▄█]/.test(line))) continue;
    const pixels = [];
    for (let y = 0; y < width; y++) {
      const output = [];
      for (let x = 0; x < width; x++) {
        const char = cells[Math.floor(y / 2)][x];
        output.push(y % 2 === 0 ? (char === ' ' || char === '▄') : (char === ' ' || char === '▀'));
      }
      pixels.push(output);
    }
    // Three finder patterns protect against treating an incomplete screen as a QR code.
    if (![[4, 4], [width - 11, 4], [4, width - 11]].every(([x, y]) => {
      for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
        const black = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        if (pixels[y + j]?.[x + i] !== black) return false;
      }
      return true;
    })) continue;
    let blocks = '';
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (pixels[y][x]) blocks += `M${x} ${y}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${blocks}" fill="black"/></svg>`;
  }
  return null;
}

export class LoginSessions {
  constructor(onSuccess, options = {}) { this.sessions = new Map(); this.onSuccess = onSuccess; this.spawn = options.spawn || pty.spawn; }
  view(session) {
    return { id: session.id, status: session.status, error: session.error || '', qrVersion: session.qrVersion || '', account: session.account || null };
  }
  get(id) { const session = this.sessions.get(id); if (!session) throw new Error('登录已过期，请重新扫码'); return this.view(session); }
  qr(id) { return this.sessions.get(id)?.qr || null; }
  start(settings, label) {
    for (const session of this.sessions.values()) if (!['success', 'failed', 'cancelled'].includes(session.status)) return this.view(session);
    const session = { id: crypto.randomUUID(), namespace: 'web_' + crypto.randomBytes(10).toString('hex'), label: String(label || '').trim().slice(0, 40), status: 'starting', qr: null };
    this.sessions.set(session.id, session);
    const terminal = new headless.Terminal({ cols: 110, rows: 70, scrollback: 100, allowProposedApi: true });
    session.terminal = terminal;
    const finish = status => {
      clearTimeout(session.timer); session.status = status;
      session.qr = null; session.qrVersion = '';
      try { session.pty?.kill(); } catch {}
      session.pty = null; terminal.dispose();
    };
    session.finish = finish;
    try {
      const child = this.spawn(settings.tdlPath, ['--proxy', settings.proxy, '--ns', session.namespace, '--reconnect-timeout', '30s', 'login', '-T', 'qr'], {
        name: 'xterm-256color', cols: 110, rows: 70, cwd: settings.cwd,
        env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1' }, useConpty: true, useConptyDll: true,
      });
      session.pty = child;
      terminal.onData(data => { try { if (session.pty) session.pty.write(data); } catch {} });
      child.onData(data => {
        if (!session.pty) return;
        terminal.write(data, () => {
          if (!session.pty) return;
          const buffer = terminal.buffer.active;
          const lines = [];
          for (let i = 0; i < buffer.length; i++) lines.push(buffer.getLine(i)?.translateToString(false) || '');
          const text = lines.join('\n');
          const success = text.match(/Login successfully! ID:\s*(\d+), Username:\s*([^\n]*)/);
          if (success && !session.account) {
            session.account = this.onSuccess({ namespace: session.namespace, label: session.label, userId: success[1], username: success[2].trim() });
            finish('success'); return;
          }
          if (/Enter 2FA Password:/.test(text) && session.status !== 'verifying') { session.status = 'password'; session.qr = null; return; }
          const qr = qrFromTerminal(lines);
          if (qr && !['password', 'verifying'].includes(session.status)) {
            session.qr = qr; session.qrVersion = crypto.createHash('sha256').update(qr).digest('hex').slice(0, 12); session.status = 'qr';
          }
          session.errorHint = text.split('\n').filter(line => /Error:|2fa auth:|FLOOD_WAIT|PASSWORD_HASH_INVALID|qr auth:/.test(line)).slice(-2).join('\n').trim().slice(-500);
        });
      });
      child.onExit(() => {
        setTimeout(() => {
          if (['success', 'failed', 'cancelled'].includes(session.status)) return;
          session.error = session.errorHint || '登录未完成，请重新扫码。若设置了二步验证，请输入 Telegram 的二步验证密码。';
          finish('failed');
        }, 250);
      });
      session.timer = setTimeout(() => { session.error = '本次登录已超时，请重新扫码'; finish('failed'); }, 5 * 60 * 1000);
      session.timer.unref();
    } catch (error) { session.error = `无法启动登录：${error.message}`; finish('failed'); }
    return this.view(session);
  }
  input(id, password) {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'password' || !session.pty) throw new Error('当前没有等待输入密码的登录，请重新扫码');
    if (typeof password !== 'string' || !password || password.length > 512 || /[\r\n\x00-\x1f]/.test(password)) throw new Error('请输入有效的二步验证密码');
    session.status = 'verifying'; session.pty.write(password + '\r');
    return this.view(session);
  }
  cancel(id) { const session = this.sessions.get(id); if (session && !['success', 'failed', 'cancelled'].includes(session.status)) session.finish('cancelled'); return this.get(id); }
  close() { for (const session of this.sessions.values()) this.cancel(session.id); }
}
