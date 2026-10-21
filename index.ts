// lang: TS | file: index.ts | runtime: Revenge JS-only plugin (@vendetta compat API)
//
// /join <userid> — one lookup, joins immediately or waits for a seat in that one channel.
//   Stops automatically the moment the target leaves that channel (no retargeting).
//
// /loopjoin <userid> <attempts> — same as /join, but if the target leaves before a seat opens,
//   does ONE fresh lookup to see where they are now and tries again. Hard-capped at `attempts`
//   (clamped to 2-3, whatever you pass) — after that many tries it stops on its own regardless
//   of outcome. Each attempt is independent: find once, wait on that one channel, stop or retry.
//   This is bounded retries, not standing presence tracking — it never runs past the attempt cap
//   and never polls for location outside of a lookup triggered by a failed attempt.
//
// /cancel — stops an active /join or /loopjoin run immediately.

import { logger } from "@vendetta";
import { findByProps } from "@vendetta/metro";
import { registerCommand } from "@vendetta/commands";

const POLL_INTERVAL_MS = 4000;
const MAX_LOOPJOIN_ATTEMPTS = 3;
const MIN_LOOPJOIN_ATTEMPTS = 2;

let unregister_join: (() => void) | null = null;
let unregister_loopjoin: (() => void) | null = null;
let unregister_cancel: (() => void) | null = null;

let active_wait: { timer: any; targetUserId: string; guildId: string; channelId: string } | null = null;
let active_loop_cancelled = false;

function probe(label: string, candidates: string[][]): any {
    for (const props of candidates) {
        const mod = findByProps(...props);
        if (mod) {
            logger.log(`[AutoJoin] ${label}: matched on [${props.join(", ")}]`);
            return mod;
        }
    }
    logger.log(`[AutoJoin] ${label}: no candidate matched — tried ${JSON.stringify(candidates)}`);
    return null;
}

function get_gateway() {
    return probe("gateway module", [["getSocket"], ["getSocketProxy"], ["gatewaySocket"], ["socket", "send"]]);
}
function get_guild_store() {
    return probe("guild store", [["getGuilds"], ["getGuild"]]);
}
function get_voice_state_store() {
    return probe("voice state store", [["getVoiceStatesForGuild"], ["getAllVoiceStates"], ["getVoiceStateForUser"]]);
}
function get_channel_store() {
    return probe("channel store", [["getChannel", "getDMFromUserId"], ["getChannel"]]);
}

function get_states_for_guild(guildId: string): Record<string, any> {
    const VoiceStateStore = get_voice_state_store();
    return (
        VoiceStateStore?.getVoiceStatesForGuild?.(guildId) ??
        VoiceStateStore?.getAllVoiceStates?.()?.[guildId] ??
        {}
    );
}

function find_user_voice_channel(userId: string): { guildId: string; channelId: string } | null {
    const GuildStore = get_guild_store();
    if (!GuildStore) return null;

    const guilds = GuildStore.getGuilds?.() ?? {};
    for (const guildId of Object.keys(guilds)) {
        const states = get_states_for_guild(guildId);
        const userState = states[userId];
        if (userState?.channelId) {
            return { guildId, channelId: userState.channelId };
        }
    }
    return null;
}

function channel_has_room(guildId: string, channelId: string): boolean {
    const ChannelStore = get_channel_store();
    const channel = ChannelStore?.getChannel?.(channelId);
    const limit = channel?.userLimit ?? 0;

    if (!limit || limit === 0) return true;

    const states = get_states_for_guild(guildId);
    const currentCount = Object.values(states).filter((s: any) => s?.channelId === channelId).length;
    return currentCount < limit;
}

function user_still_in_channel(userId: string, guildId: string, channelId: string): boolean {
    const states = get_states_for_guild(guildId);
    return states[userId]?.channelId === channelId;
}

function join_channel(guildId: string, channelId: string): boolean {
    const socket = get_gateway()?.getSocket?.();
    if (!socket) {
        logger.log("[AutoJoin] socket unavailable — cannot join");
        return false;
    }
    socket.send(4, {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: false,
        self_deaf: false,
        self_video: false,
        flags: 0,
    });
    logger.log(`[AutoJoin] sent join for guild ${guildId} channel ${channelId}`);
    return true;
}

function stop_active_wait(reason: string) {
    if (!active_wait) return;
    clearInterval(active_wait.timer);
    logger.log(`[AutoJoin] wait stopped: ${reason}`);
    active_wait = null;
}

function wait_for_seat(userId: string, guildId: string, channelId: string): Promise<"joined" | "left" | "cancelled"> {
    return new Promise((resolve) => {
        stop_active_wait("new wait replacing previous");

        const timer = setInterval(() => {
            if (active_loop_cancelled) {
                stop_active_wait("cancelled");
                resolve("cancelled");
                return;
            }
            if (!user_still_in_channel(userId, guildId, channelId)) {
                stop_active_wait(`target left channel ${channelId}`);
                resolve("left");
                return;
            }
            if (channel_has_room(guildId, channelId)) {
                join_channel(guildId, channelId);
                stop_active_wait("seat opened, joined");
                resolve("joined");
            }
        }, POLL_INTERVAL_MS);

        active_wait = { timer, targetUserId: userId, guildId, channelId };
    });
}

function run_join(userId: string): string {
    const location = find_user_voice_channel(userId);
    if (!location) {
        return "That user isn't in a voice channel in any server you share.";
    }
    if (channel_has_room(location.guildId, location.channelId)) {
        const ok = join_channel(location.guildId, location.channelId);
        return ok ? "Joining now." : "Found the channel but couldn't join — check the log.";
    }
    wait_for_seat(userId, location.guildId, location.channelId);
    return "That channel is full. Waiting for a seat — I'll join automatically when one opens, or stop if they leave. Use /cancel to stop waiting.";
}

async function run_loopjoin(userId: string, attempts: number) {
    active_loop_cancelled = false;
    const capped = Math.max(MIN_LOOPJOIN_ATTEMPTS, Math.min(MAX_LOOPJOIN_ATTEMPTS, attempts));

    for (let attempt = 1; attempt <= capped; attempt++) {
        if (active_loop_cancelled) {
            logger.log("[AutoJoin] loopjoin cancelled before attempt " + attempt);
            return;
        }

        const location = find_user_voice_channel(userId);
        if (!location) {
            logger.log(`[AutoJoin] loopjoin attempt ${attempt}/${capped}: user not in any voice channel`);
            continue;
        }

        if (channel_has_room(location.guildId, location.channelId)) {
            join_channel(location.guildId, location.channelId);
            logger.log(`[AutoJoin] loopjoin attempt ${attempt}/${capped}: joined immediately`);
            return;
        }

        logger.log(`[AutoJoin] loopjoin attempt ${attempt}/${capped}: channel full, waiting for seat`);
        const outcome = await wait_for_seat(userId, location.guildId, location.channelId);

        if (outcome === "joined") {
            logger.log(`[AutoJoin] loopjoin attempt ${attempt}/${capped}: seat opened, joined`);
            return;
        }
        if (outcome === "cancelled") {
            logger.log(`[AutoJoin] loopjoin cancelled during attempt ${attempt}`);
            return;
        }
    }

    logger.log(`[AutoJoin] loopjoin exhausted ${capped} attempts without joining`);
}

export default {
    onLoad: () => {
        logger.log("[AutoJoin] loading");

        unregister_join = registerCommand({
            name: "join",
            displayName: "join",
            description: "Join a user's current voice channel; waits for a seat if it's full",
            displayDescription: "Join a user's current voice channel; waits for a seat if it's full",
            options: [
                {
                    name: "userid",
                    displayName: "userid",
                    description: "The user ID to find and join",
                    displayDescription: "The user ID to find and join",
                    type: 3,
                    required: true,
                },
            ],
            applicationId: "-1",
            inputType: 1,
            type: 1,
            execute: (args, _ctx) => {
                const userId = args?.find((a: any) => a.name === "userid")?.value;
                if (!userId) return { send: false, result: "Provide a user ID: /join <userid>" };
                return { send: false, result: run_join(String(userId)) };
            },
        });

        unregister_loopjoin = registerCommand({
            name: "loopjoin",
            displayName: "loopjoin",
            description: "Like /join, but retries a couple times if they move before a seat opens (max 3 attempts)",
            displayDescription: "Like /join, but retries a couple times if they move before a seat opens (max 3 attempts)",
            options: [
                {
                    name: "userid",
                    displayName: "userid",
                    description: "The user ID to find and join",
                    displayDescription: "The user ID to find and join",
                    type: 3,
                    required: true,
                },
                {
                    name: "attempts",
                    displayName: "attempts",
                    description: "How many times to retry (2-3)",
                    displayDescription: "How many times to retry (2-3)",
                    type: 4,
                    required: false,
                },
            ],
            applicationId: "-1",
            inputType: 1,
            type: 1,
            execute: (args, _ctx) => {
                const userId = args?.find((a: any) => a.name === "userid")?.value;
                const attemptsRaw = args?.find((a: any) => a.name === "attempts")?.value;
                if (!userId) return { send: false, result: "Provide a user ID: /loopjoin <userid> <attempts>" };

                const attempts = attemptsRaw ? Number(attemptsRaw) : MAX_LOOPJOIN_ATTEMPTS;
                run_loopjoin(String(userId), attempts);

                return {
                    send: false,
                    result: `Trying up to ${Math.max(MIN_LOOPJOIN_ATTEMPTS, Math.min(MAX_LOOPJOIN_ATTEMPTS, attempts))} times — I'll stop automatically after that or if you /cancel.`,
                };
            },
        });

        unregister_cancel = registerCommand({
            name: "cancel",
            displayName: "cancel",
            description: "Stop an active /join or /loopjoin",
            displayDescription: "Stop an active /join or /loopjoin",
            options: [],
            applicationId: "-1",
            inputType: 1,
            type: 1,
            execute: (_args, _ctx) => {
                active_loop_cancelled = true;
                if (!active_wait) {
                    return { send: false, result: "No active wait to cancel." };
                }
                stop_active_wait("cancelled by user");
                return { send: false, result: "Cancelled." };
            },
        });
    },
    onUnload: () => {
        active_loop_cancelled = true;
        stop_active_wait("plugin unloaded");
        unregister_join?.();
        unregister_loopjoin?.();
        unregister_cancel?.();
        unregister_join = null;
        unregister_loopjoin = null;
        unregister_cancel = null;
    },
}
