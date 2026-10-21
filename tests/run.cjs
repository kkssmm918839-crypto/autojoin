'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'dist/index.js'), 'utf8');
let states = {};
let selected = 'vc-old';
let permission = true;
const moved = [];
const handlers = {};
const commandProvider = { getBuiltInCommands: () => [{ name: 'hello', id: '-1' }] };
const actions = { selectVoiceChannel: channel => { selected = channel; moved.push(channel); } };
const channels = {
  'vc-old': { id: 'vc-old', guild_id: 'server-a' },
  'vc-new': { id: 'vc-new', guild_id: 'server-a' },
  'vc-other': { id: 'vc-other', guild_id: 'server-b' },
  'vc-private': { id: 'vc-private', guild_id: 'server-a' },
};
const React = { useState(initial) { return [initial, () => {}]; }, createElement(type, props, ...children) { return { type, props, children }; } };
const mockRevenge = {
  discord: {
    actions: { ToastActionCreators: { open() {} } },
    flux: {
      Stores: {
        UserStore: { getCurrentUser() { return { id: '123456789012345678' }; } },
        SelectedChannelStore: { getVoiceChannelId: () => selected },
        ChannelStore: { getChannel: id => channels[id] },
        PermissionStore: { can: (_flag, channel) => permission && channel.id !== 'vc-private' },
      },
      onFluxEventDispatched(name, fn) {
        handlers[name] = fn;
        return () => { delete handlers[name]; };
      },
    },
  },
  modules: { finders: {
    filters: { withProps: (...keys) => keys },
    lookupModule(filter) {
      const key = filter[0];
      if (key === 'selectVoiceChannel') return [actions, 2];
      if (key === 'getBuiltInCommands') return [commandProvider, 3];
      return [undefined, undefined];
    },
  } },
  patcher: { after(parent, key, hook) {
    const before = parent[key];
    parent[key] = (...args) => hook(args, before(...args));
    return () => { parent[key] = before; };
  } },
  react: { React, ReactNative: {
    Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput',
  } },
};
const config = new Function('revenge', 'return ' + script)(mockRevenge);
assert.equal(typeof config.start, 'function');
assert.equal(typeof config.SettingsComponent, 'function');
const cleanupFunctions = [];
const storage = { cache: { enabled: false, targetUserId: '' }, set(next) { this.cache = next; }, use() { return this.cache; } };
config.start({ jsonStorage: storage, cleanup(...fns) { cleanupFunctions.push(...fns); }, logger: { log() {}, warn() {} } });
const commands = commandProvider.getBuiltInCommands();
assert.equal(commands.filter(cmd => cmd.name === 'vcf').length, 1);
assert.equal(commands.filter(cmd => cmd.name === 'vcunf').length, 1);
const follow = commands.find(cmd => cmd.name === 'vcf');
const stop = commands.find(cmd => cmd.name === 'vcunf');
follow.execute([{ value: '234567890123456789' }]);
assert.equal(storage.cache.targetUserId, '234567890123456789');
assert.equal(storage.cache.enabled, true);
const emit = (channelId, guildId = 'server-a', oldId = 'vc-old') => handlers['VOICE_STATE_UPDATES']({ voiceStates: [{
  userId: '234567890123456789', guildId, channelId, oldChannelId: oldId,
}] });
emit('vc-new');
assert.deepEqual(moved, ['vc-new']);
selected = 'vc-old';
emit('vc-other', 'server-b');
assert.deepEqual(moved, ['vc-new'], 'Does not follow across servers');
emit('vc-private');
assert.deepEqual(moved, ['vc-new'], 'Respects inaccessible channels');
stop.execute();
assert.equal(storage.cache.enabled, false);
emit('vc-new');
assert.deepEqual(moved, ['vc-new'], 'Stop following prevents further moves');
config.SettingsComponent({ api: { jsonStorage: storage } });
cleanupFunctions.forEach(cleanup => cleanup());
assert.equal(Object.keys(handlers).length, 0, 'All listeners were cleaned up');
console.log('PASS: plugin evaluation, command registration, VC follow, same-server check, permissions, stop, settings, lifecycle cleanup');
