import path from 'node:path';

export function directory(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请选择下载文件夹');
  const result = value.trim();
  if (!/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(result) || /[\x00-\x1f<>"|?*]/.test(result)) {
    throw new Error('请输入完整的文件夹路径，例如 D:\\Telegram下载');
  }
  if (result.slice(2).includes(':')) throw new Error('文件夹路径无效');
  return path.win32.normalize(result);
}

export function messageLinks(value) {
  const links = Array.isArray(value) ? value : String(value ?? '').trim().split(/\s+/);
  if (!links.length || links.length > 50) throw new Error('每次请输入 1 至 50 条消息链接');
  return [...new Set(links.map(link => {
    let url;
    try { url = new URL(link); } catch { throw new Error('消息链接格式不正确'); }
    if (url.protocol !== 'https:' || url.hostname !== 't.me' || url.port || url.username || url.password || !/^\/(?:c\/\d+|[a-zA-Z0-9_]+)\/(?:\d+\/)?\d+\/?$/.test(url.pathname)) {
      throw new Error('请使用具体的 Telegram 消息链接，例如 https://t.me/telegram/193');
    }
    return url.href;
  }))];
}

export function positiveInt(value, min, max, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name}应在 ${min} 至 ${max} 之间`);
  return number;
}

export function chatId(value) {
  const result = String(value ?? '');
  if (result === 'saved') return result;
  if (!/^-?\d{1,16}$/.test(result)) throw new Error('请选择有效会话');
  return result;
}

export function withSavedMessages(chats) {
  return [{id:'saved',type:'saved',visible_name:'我的收藏 / Saved Messages',username:'saved',isSaved:true}, ...chats.filter(chat=>String(chat.id)!=='saved')];
}

export function plainLog(text) {
  return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

export function tdlJson(text, type = 'array') {
  const clean = plainLog(text).trim();
  try { return JSON.parse(clean); } catch {}
  const start = type === 'array' ? clean.indexOf('[') : clean.indexOf('{');
  const end = type === 'array' ? clean.lastIndexOf(']') : clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('没有取得有效的会话数据，请检查登录状态');
  return JSON.parse(clean.slice(start, end + 1));
}
