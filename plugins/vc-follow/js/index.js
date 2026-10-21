// VC Follow — Revenge Next
// Source entry matches the official `export default plugin(...)` convention.
// All Discord module lookups that aren't part of Revenge's public API are optional.
const DEFAULT_SETTINGS = Object.freeze({ enabled: false, targetUserId: '', status: 'Not following' });
let pluginApi = null;
let lastMoveChannel = null;
let lastMoveAt = 0;

function currentSettings() {
    return { ...DEFAULT_SETTINGS, ...(pluginApi?.jsonStorage?.cache ?? {}) };
}
function setSettings(updates) {
    if (!pluginApi) return;
    pluginApi.jsonStorage.set({ ...currentSettings(), ...updates });
}
function notice(text) {
    try {
        revenge.discord.actions.ToastActionCreators.open({ key: 'vc-follow-toast', content: text });
    } catch (err) {
        pluginApi?.logger?.log?.('VC Follow: ' + text);
    }
}
function logError(err) {
    pluginApi?.logger?.warn?.('VC Follow: ' + String(err));
}
function getStore(name) {
    try { return revenge.discord.flux.Stores[name]; } catch (_) { return null; }
}
function normalizeUserId(raw) {
    const match = String(raw ?? '').trim().match(/^(?:<@!?)?(\d{15,22})>?$/);
    return match?.[1] ?? null;
}
function getCurrentUser() {
    try { return getStore('UserStore')?.getCurrentUser?.()?.id ?? null; }
    catch (_) { return null; }
}
function ownVoiceChannelId() {
    try { return getStore('SelectedChannelStore')?.getVoiceChannelId?.() ?? null; }
    catch (_) { return null; }
}
function getChannel(id) {
    try { return getStore('ChannelStore')?.getChannel?.(id) ?? null; }
    catch (_) { return null; }
}
function findDiscordModule(...props) {
    try {
        const { lookupModule, filters } = revenge.modules.finders;
        const [mod, id] = lookupModule(filters.withProps(...props));
        return id === undefined ? null : mod;
    } catch (err) { logError(err); return null; }
}
function isAccessible(channel) {
    // Fail closed when permissions aren't readable. Discord still checks connection rights.
    if (!channel?.guild_id) return false;
    try {
        const permissions = getStore('PermissionStore');
        if (typeof permissions?.can !== 'function') return false;
        return Boolean(permissions.can(1n << 20n, channel)); // Discord CONNECT permission
    } catch (_) { return false; }
}
function follow(target) {
    const id = normalizeUserId(target);
    if (!id) return 'Enter a valid Discord user ID (15–22 digits).';
    if (id === getCurrentUser()) return 'You cannot follow yourself.';
    lastMoveChannel = null;
    setSettings({ enabled: true, targetUserId: id, status: 'Following ' + id });
    notice('VC Follow enabled');
    return 'Following ' + id + '. Join a voice channel in the same server.';
}
function unfollow() {
    lastMoveChannel = null;
    setSettings({ enabled: false, targetUserId: '', status: 'Not following' });
    notice('VC Follow disabled');
    return 'Stopped following.';
}
function maybeFollowMove(userId, guildId, destinationId, oldId) {
    const prefs = currentSettings();
    if (!prefs.enabled || !prefs.targetUserId || userId !== prefs.targetUserId) return;
    if (!destinationId || destinationId === oldId) return;
    const mineId = ownVoiceChannelId();
    if (!mineId || mineId === destinationId) return;
    const mine = getChannel(mineId);
    const destination = getChannel(destinationId);
    if (!mine || !destination || !guildId ||
        String(mine.guild_id) !== String(guildId) ||
        String(destination.guild_id) !== String(guildId)) return;
    if (!isAccessible(destination)) {
        setSettings({ status: 'Cannot join: channel is inaccessible' });
        return;
    }
    if (lastMoveChannel === destinationId || Date.now() - lastMoveAt < 1100) return;
    const actions = findDiscordModule('selectVoiceChannel');
    if (!actions || typeof actions.selectVoiceChannel !== 'function') {
        setSettings({ status: 'Voice switching not supported on this Discord build' });
        return;
    }
    try {
        actions.selectVoiceChannel(destinationId);
        lastMoveAt = Date.now();
        lastMoveChannel = destinationId;
        setSettings({ status: 'Following ' + userId + ' • moved VC' });
    } catch (err) {
        logError(err);
        setSettings({ status: 'VC switch failed; see Revenge debug logs' });
    }
}
function handleVoiceUpdate(payload) {
    const states = payload?.voiceStates ?? payload?.voice_states ??
        (payload?.voiceState ? [payload.voiceState] : [payload]);
    if (!Array.isArray(states)) return;
    for (const state of states) {
        if (!state) continue;
        const userId = String(state.userId ?? state.user_id ?? state.user?.id ?? '');
        const guildId = state.guildId ?? state.guild_id ?? payload?.guildId ?? payload?.guild_id;
        const destinationId = state.channelId ?? state.channel_id ?? null;
        const oldId = state.oldChannelId ?? state.old_channel_id ?? null;
        maybeFollowMove(userId, guildId, destinationId, oldId);
    }
}
function argUserId(args) {
    const first = Array.isArray(args) ? args[0] : args;
    const raw = first?.value ?? first?.user?.id ?? first?.id ?? first;
    return normalizeUserId(typeof raw === 'object' ? raw?.id ?? raw?.value : raw);
}
function registerSlashCommands(cleanup) {
    // Discord internal registration; may change between app versions.
    const commandsMod = findDiscordModule('getBuiltInCommands');
    if (!commandsMod || typeof commandsMod.getBuiltInCommands !== 'function') return;
    const after = revenge.patcher?.after;
    if (typeof after !== 'function') return;
    const commands = [
        {
            id: '-8765401', applicationId: '-1', type: 1, inputType: 0,
            name: 'vcf', displayName: 'vcf',
            description: 'Auto-follow a friend between VCs', displayDescription: 'Auto-follow a friend between VCs',
            options: [{ type: 6, name: 'user', displayName: 'user', required: true,
                description: 'Friend to follow', displayDescription: 'Friend to follow' }],
            execute: args => { notice(follow(argUserId(args))); },
        },
        {
            id: '-8765402', applicationId: '-1', type: 1, inputType: 0,
            name: 'vcunf', displayName: 'vcunf',
            description: 'Stop following VC', displayDescription: 'Stop following VC',
            options: [], execute: () => { unfollow(); },
        },
    ];
    try {
        cleanup(after(commandsMod, 'getBuiltInCommands', (_args, result) => {
            if (!Array.isArray(result)) return result;
            const existing = new Set(result.map(cmd => cmd?.name));
            return result.concat(commands.filter(cmd => !existing.has(cmd.name)));
        }));
    } catch (err) { logError(err); }
}
function registerProfileToggle(cleanup) {
    // This is deliberately optional: Discord user-profile action providers are private APIs.
    const after = revenge.patcher?.after;
    if (typeof after !== 'function') return;
    for (const key of ['getUserProfileActions', 'getUserProfileActionItems']) {
        const module = findDiscordModule(key);
        if (!module || typeof module[key] !== 'function') continue;
        try {
            cleanup(after(module, key, (args, items) => {
                if (!Array.isArray(items)) return items;
                const first = args?.[0];
                const id = normalizeUserId(first?.user?.id ?? first?.userId ?? first?.id);
                if (!id || id === getCurrentUser()) return items;
                if (items.some(item => item?.id === 'vc-follow-toggle')) return items;
                const following = currentSettings().enabled && currentSettings().targetUserId === id;
                const action = () => following ? unfollow() : follow(id);
                return items.concat([{
                    id: 'vc-follow-toggle',
                    label: following ? 'Unfollow VC' : 'Follow VC',
                    text: following ? 'Unfollow VC' : 'Follow VC',
                    onPress: action, action,
                }]);
            }));
            break;
        } catch (err) { logError(err); }
    }
}
function SettingsComponent({ api }) {
    const React = revenge.react.React;
    const RN = revenge.react.ReactNative;
    const store = api.jsonStorage.use() ?? DEFAULT_SETTINGS;
    const [input, setInput] = React.useState(store.targetUserId || '');
    const [feedback, setFeedback] = React.useState('');
    const el = React.createElement;
    const label = (value, extra) => el(RN.Text, {
        style: { color: '#eeeeee', fontSize: 15, marginBottom: 11, ...extra },
    }, value);
    const button = (text, fn, background) => el(RN.Pressable, {
        onPress: fn,
        style: { backgroundColor: background, borderRadius: 9, padding: 14,
            alignItems: 'center', marginVertical: 6 },
    }, label(text, { color: '#ffffff', marginBottom: 0, fontWeight: 'bold' }));
    return el(RN.ScrollView, {
        style: { flex: 1 }, contentContainerStyle: { padding: 20 },
    },
        label('VC Follow', { fontSize: 22, fontWeight: 'bold' }),
        label('When the selected user switches voice channels in your current server, you automatically move too. You must already be in a VC.'),
        label('Status: ' + (store.status || 'Not following')),
        label('Friend Discord user ID'),
        el(RN.TextInput, {
            value: input, onChangeText: setInput, autoCapitalize: 'none',
            placeholder: '123456789012345678', keyboardType: 'numeric',
            placeholderTextColor: '#aaaaaa',
            style: { backgroundColor: '#25282e', color: '#fff', fontSize: 16,
                padding: 12, borderRadius: 9, marginBottom: 10 },
        }),
        button('Follow VC', () => setFeedback(follow(input)), '#5865f2'),
        button('Unfollow VC', () => { setFeedback(unfollow()); setInput(''); }, '#484b54'),
        label(feedback, { color: '#b9c6ff', marginTop: 10 }),
        label('Experimental shortcuts: /vcf @user and /vcunf. The user-profile button may not appear on all Discord versions.',
            { color: '#aaaaaa', fontSize: 12, marginTop: 12 }),
    );
}

export default plugin({
    jsonStorage: { load: true, default: DEFAULT_SETTINGS },
    start(api) {
        pluginApi = api;
        lastMoveAt = 0;
        lastMoveChannel = null;
        const { cleanup } = api;
        try {
            cleanup(revenge.discord.flux.onFluxEventDispatched('VOICE_STATE_UPDATES', handleVoiceUpdate));
            cleanup(revenge.discord.flux.onFluxEventDispatched('VOICE_STATE_UPDATE', handleVoiceUpdate));
        } catch (err) { logError(err); }
        registerSlashCommands(cleanup);
        registerProfileToggle(cleanup);
        cleanup(() => { pluginApi = null; lastMoveChannel = null; });
        api.logger?.log?.('VC Follow started');
    },
    SettingsComponent,
});
