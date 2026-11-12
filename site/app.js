// UUIDs must match BusyLight/BusyLight.ino in the firmware image.
const SERVICE_UUID = '7172deda-11a4-42ff-a8a4-aed654cd1902';
const COLOR_UUIDS = {
  top: 'ef6ea611-33e1-4eb1-a266-1001767c4f6d',
  front: '43812956-2215-4715-ac82-5daf5ef1b5d0',
};
const STORAGE_KEY = 'busy-light-preview-v2';
const DEFAULTS = { top: '#ff0000', front: '#ffffff', busy: false };
const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

const devicePreview = document.getElementById('device');
const busyInput = document.getElementById('busy');
const colorInputs = { top: document.getElementById('top'), front: document.getElementById('front') };
const connectButton = document.getElementById('connect');
const status = document.getElementById('connectionStatus');
const timers = {};
let writeQueue = Promise.resolve();
let state = { ...DEFAULTS };
let bleDevice = null;
let characteristics = {};
let connectionGeneration = 0;

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  for (const part of ['top', 'front']) if (validColor(saved[part])) state[part] = saved[part];
  if (typeof saved.busy === 'boolean') state.busy = saved.busy;
} catch (_) { /* The page still works when storage is unavailable. */ }

function remember() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* Optional. */ }
}

function render() {
  for (const part of ['top', 'front']) {
    colorInputs[part].value = state[part];
    document.getElementById(part + 'Value').textContent = state[part].toUpperCase();
  }
  document.documentElement.style.setProperty('--top-color', state.top);
  document.documentElement.style.setProperty('--front-color', state.front);
  busyInput.checked = state.busy;
  devicePreview.classList.toggle('busy', state.busy);
  devicePreview.classList.toggle('docked', !state.busy);
  document.getElementById('modeText').textContent = state.busy
    ? 'Концевик отпущен: верхний индикатор светит, передние анимируются.'
    : 'Концевик нажат: верхний индикатор выключен.';
}

function connected() {
  return Boolean(bleDevice?.gatt?.connected && characteristics.top && characteristics.front);
}

function disconnected(event) {
  if (event && event.target !== bleDevice) return;
  bleDevice?.removeEventListener('gattserverdisconnected', disconnected);
  connectionGeneration += 1;
  for (const part of ['top', 'front']) clearTimeout(timers[part]);
  writeQueue = Promise.resolve();
  bleDevice = null;
  characteristics = {};
  connectButton.textContent = 'Подключить устройство';
  status.textContent = 'Связь с платой прервана. Можно подключиться снова.';
}

async function connect() {
  if (connected()) {
    bleDevice.gatt.disconnect();
    disconnected();
    return;
  }
  if (!navigator.bluetooth) {
    status.textContent = 'Этот браузер не поддерживает Web Bluetooth. Откройте страницу в Chrome на Android или в Chrome/Edge на компьютере.';
    return;
  }
  if (!window.isSecureContext) {
    status.textContent = 'Для Bluetooth откройте страницу через HTTPS или localhost.';
    return;
  }

  connectButton.disabled = true;
  status.textContent = 'Выберите ближайшую BusyLight-C6 в окне браузера…';
  let selected = null;
  try {
    // Browsers allow the chooser only after a click by the user.
    selected = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
    selected.addEventListener('gattserverdisconnected', disconnected);
    const server = await selected.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const top = await service.getCharacteristic(COLOR_UUIDS.top);
    const front = await service.getCharacteristic(COLOR_UUIDS.front);
    const decoder = new TextDecoder();
    const topValue = decoder.decode(await top.readValue());
    const frontValue = decoder.decode(await front.readValue());
    if (!validColor(topValue) || !validColor(frontValue)) throw new Error('Плата вернула неверный формат цвета.');
    if (!selected.gatt.connected) throw new Error('Соединение прервалось во время чтения цветов.');

    bleDevice = selected;
    characteristics = { top, front };
    connectionGeneration += 1;
    state.top = topValue.toLowerCase();
    state.front = frontValue.toLowerCase();
    render();
    remember();
    connectButton.textContent = 'Отключить';
    status.textContent = 'Подключено к ' + (selected.name || 'BusyLight-C6') + '. Изменения цветов отправляются на плату.';
  } catch (error) {
    characteristics = {};
    if (selected) selected.removeEventListener('gattserverdisconnected', disconnected);
    if (selected?.gatt?.connected) selected.gatt.disconnect();
    bleDevice = null;
    const message = error.name === 'NotFoundError'
      ? 'Устройство не выбрано. Убедитесь, что плата включена и находится рядом.'
      : 'Не удалось подключиться: ' + error.message;
    status.textContent = message;
  } finally {
    connectButton.disabled = false;
  }
}

function scheduleWrite(part) {
  clearTimeout(timers[part]);
  if (!connected()) return;
  const generation = connectionGeneration;
  const characteristic = characteristics[part];
  status.textContent = 'Отправка цвета…';
  timers[part] = setTimeout(() => {
    if (!connected() || generation !== connectionGeneration || characteristics[part] !== characteristic) return;
    const data = new TextEncoder().encode(state[part].toUpperCase());
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      if (!connected() || generation !== connectionGeneration || characteristics[part] !== characteristic) return;
      if (characteristic.writeValueWithResponse) await characteristic.writeValueWithResponse(data);
      else await characteristic.writeValue(data);
      if (generation === connectionGeneration) {
        status.textContent = 'Цвет отправлен на плату и будет сохранён в её памяти.';
      }
    }).catch(error => {
      if (generation === connectionGeneration) status.textContent = 'Не удалось передать цвет: ' + error.message;
    });
  }, 180);
}

for (const part of ['top', 'front']) {
  colorInputs[part].addEventListener('input', event => {
    state[part] = event.target.value;
    render();
    remember();
    scheduleWrite(part);
  });
}
busyInput.addEventListener('change', () => { state.busy = busyInput.checked; render(); remember(); });
document.getElementById('reset').addEventListener('click', () => {
  state = { ...DEFAULTS };
  render();
  remember();
  scheduleWrite('top');
  scheduleWrite('front');
});
connectButton.addEventListener('click', connect);
if (!navigator.bluetooth) status.textContent = 'Предпросмотр работает, но этот браузер не поддерживает Web Bluetooth.';
render();
