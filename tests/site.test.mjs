import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
const serviceUuid = '7172deda-11a4-42ff-a8a4-aed654cd1902';
const topUuid = 'ef6ea611-33e1-4eb1-a266-1001767c4f6d';
const frontUuid = '43812956-2215-4715-ac82-5daf5ef1b5d0';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function makeElement() {
  return {
    value: '', textContent: '', disabled: false, checked: false, handlers: {},
    classList: { toggle() {} },
    addEventListener(name, handler) { this.handlers[name] = handler; },
  };
}

function makeCharacteristic(initial) {
  return {
    value: initial,
    writes: [],
    async readValue() {
      return new DataView(new TextEncoder().encode(this.value).buffer);
    },
    async writeValueWithResponse(bytes) {
      this.value = new TextDecoder().decode(bytes);
      this.writes.push(this.value);
    },
  };
}

function makeDevice() {
  const top = makeCharacteristic('#FF0000');
  const front = makeCharacteristic('#FFFFFF');
  const listeners = new Set();
  const device = {
    name: 'BusyLight-C6', top, front, listeners,
    addEventListener(_name, handler) { listeners.add(handler); },
    removeEventListener(_name, handler) { listeners.delete(handler); },
  };
  device.gatt = {
    connected: false,
    async connect() {
      this.connected = true;
      return {
        async getPrimaryService(uuid) {
          assert.equal(uuid, serviceUuid);
          return { async getCharacteristic(id) { return id === topUuid ? top : id === frontUuid ? front : null; } };
        },
      };
    },
    disconnect() {
      this.connected = false;
      for (const handler of [...listeners]) handler({ target: device });
    },
  };
  return device;
}

test('a delayed write or disconnect from an old board cannot affect a new connection', async () => {
  const elements = Object.fromEntries(
    ['device', 'busy', 'top', 'front', 'connect', 'connectionStatus', 'topValue', 'frontValue', 'modeText', 'reset']
      .map(id => [id, makeElement()]),
  );
  const first = makeDevice();
  const second = makeDevice();
  const choices = [first, second];
  const context = {
    document: {
      getElementById: id => elements[id],
      documentElement: { style: { setProperty() {} } },
    },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { bluetooth: { async requestDevice() { return choices.shift(); } } },
    window: { isSecureContext: true },
    TextEncoder, TextDecoder, setTimeout, clearTimeout,
  };
  vm.runInNewContext(source, context);

  await elements.connect.handlers.click();
  assert.equal(elements.connect.textContent, 'Отключить');
  const oldDisconnect = [...first.listeners][0];
  elements.top.value = '#00ff00';
  elements.top.handlers.input({ target: elements.top });
  await elements.connect.handlers.click();
  await elements.connect.handlers.click();
  oldDisconnect({ target: first });
  await pause(240);
  assert.deepEqual(first.top.writes, []);
  assert.equal(elements.connect.textContent, 'Отключить');

  elements.front.value = '#0000ff';
  elements.front.handlers.input({ target: elements.front });
  await pause(240);
  assert.deepEqual(second.front.writes, ['#0000FF']);
  assert.equal(elements.connectionStatus.textContent.includes('Цвет отправлен'), true);
});
