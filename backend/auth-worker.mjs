import { LoginSessions } from './login.mjs';
const manager = new LoginSessions(info => info);
let id = null, poller = null, signature = '';
function publish() {
  if (!id) return;
  const view = manager.get(id), qr = manager.qr(id);
  const message = { ...view, qr };
  const next = JSON.stringify(message);
  if (next !== signature) { signature = next; process.send?.(message); }
  if (['success','failed','cancelled'].includes(view.status)) {
    clearInterval(poller);
    setTimeout(() => process.exit(0), 400);
  }
}
process.on('message', message => {
  try {
    if (message.type === 'start') {
      id = manager.start(message.settings, message.label).id;
      poller = setInterval(publish, 150); publish();
    } else if (message.type === 'input') { manager.input(id, message.password); publish(); }
    else if (message.type === 'cancel') { manager.cancel(id); publish(); }
  } catch (error) { process.send?.({status:'failed',error:error.message}); setTimeout(() => process.exit(1), 200); }
});
process.on('disconnect', () => { manager.close(); process.exit(0); });
