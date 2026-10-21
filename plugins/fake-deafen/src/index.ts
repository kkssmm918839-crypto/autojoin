import { logger } from "@vendetta";
import { findByProps } from "@vendetta/metro";
import { registerCommand } from "@vendetta/commands";
import { storage } from "@vendetta/plugin";
import Settings from "./Settings";

let original_send: any = null;
let unregister_command: (() => void) | null = null;

function probe(label: string, candidates: string[][]): any {
    for (const props of candidates) {
        const mod = findByProps(...props);
        if (mod) {
            logger.log(`[FakeDeafen] ${label}: matched on [${props.join(", ")}]`);
            return mod;
        }
    }
    logger.log(`[FakeDeafen] ${label}: no candidate matched — tried ${JSON.stringify(candidates)}`);
    return null;
}

function get_gateway() {
    return probe("gateway module", [
        ["getSocket"],
        ["getSocketProxy"],
        ["gatewaySocket"],
        ["socket", "send"],
    ]);
}

function get_voice_channel_store() {
    return probe("selected voice channel store", [
        ["getVoiceChannelId"],
        ["getCurrentVoiceChannelId"],
        ["getSelectedVoiceChannelId"],
    ]);
}

function get_channel_store() {
    return probe("channel store", [
        ["getChannel", "getDMFromUserId"],
        ["getChannel"],
    ]);
}

function get_media_engine_store() {
    return probe("media engine store", [
        ["isSelfMute", "isSelfDeaf"],
        ["isMute", "isDeaf"],
        ["isLocalMute", "isLocalDeaf"],
    ]);
}

function patch_socket_send() {
    const socket = get_gateway()?.getSocket?.();
    if (!socket || typeof socket.send !== "function") {
        logger.log("[FakeDeafen] socket unavailable or wrong shape — patch skipped");
        return;
    }
    original_send = socket.send;
    socket.send = function (op: number, data: any, ...args: any[]) {
        if (op === 4 && storage.enabled && data) {
            if (storage.fakeMute) data.self_mute = true;
            if (storage.fakeDeafen) data.self_deaf = true;
        }
        return original_send.apply(this, [op, data, ...args]);
    };
    logger.log("[FakeDeafen] socket.send patched");
}

function unpatch_socket_send() {
    const socket = get_gateway()?.getSocket?.();
    if (socket && original_send) {
        socket.send = original_send;
        original_send = null;
    }
}

function force_voice_state_push() {
    const wsModule = get_gateway();
    const VoiceChannelStore = get_voice_channel_store();
    const ChannelStore = get_channel_store();
    const MediaEngineStore = get_media_engine_store();

    if (!wsModule || !VoiceChannelStore) {
        logger.log("[FakeDeafen] cannot force push — missing gateway or voice channel store");
        return;
    }

    const socket = wsModule.getSocket?.();
    const channelId =
        VoiceChannelStore.getVoiceChannelId?.() ??
        VoiceChannelStore.getCurrentVoiceChannelId?.() ??
        VoiceChannelStore.getSelectedVoiceChannelId?.();

    if (!socket || !channelId) {
        logger.log("[FakeDeafen] not in a voice channel, or socket missing — /fake needs an active call");
        return;
    }

    const channel = ChannelStore?.getChannel?.(channelId);
    const realMute = MediaEngineStore?.isSelfMute?.() ?? MediaEngineStore?.isMute?.() ?? MediaEngineStore?.isLocalMute?.() ?? false;
    const realDeaf = MediaEngineStore?.isSelfDeaf?.() ?? MediaEngineStore?.isDeaf?.() ?? MediaEngineStore?.isLocalDeaf?.() ?? false;

    socket.send(4, {
        guild_id: channel?.guild_id ?? null,
        channel_id: channelId,
        self_mute: (storage.enabled && storage.fakeMute) || realMute,
        self_deaf: (storage.enabled && storage.fakeDeafen) || realDeaf,
        self_video: false,
        flags: 0,
    });
    logger.log(`[FakeDeafen] pushed voice state, enabled=${storage.enabled}`);
}

function toggle() {
    storage.enabled = !storage.enabled;
    force_voice_state_push();
    return storage.enabled
        ? "Fake Deafen ON — you appear deafened+muted, mic still live."
        : "Fake Deafen OFF — back to normal.";
}

export default {
    onLoad: () => {
        storage.enabled ??= false;
        storage.fakeMute ??= true;
        storage.fakeDeafen ??= true;
        logger.log("[FakeDeafen] loading — running module probes");
        patch_socket_send();

        unregister_command = registerCommand({
            name: "fake",
            displayName: "fake",
            description: "Instantly toggle fake deafen",
            displayDescription: "Instantly toggle fake deafen",
            options: [],
            applicationId: "-1",
            inputType: 1,
            type: 1,
            execute: (_args, ctx) => {
                const resultText = toggle();
                return {
                    send: false,
                    result: resultText,
                };
            },
        });
    },
    onUnload: () => {
        unpatch_socket_send();
        storage.enabled = false;
        unregister_command?.();
        unregister_command = null;
    },
    settings: Settings,
}
