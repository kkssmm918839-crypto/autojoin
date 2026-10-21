import { storage } from "@vendetta/plugin";
import { Forms } from "@vendetta/ui/components";
import { showToast } from "@vendetta/ui/toasts";
import { useProxy } from "@vendetta/storage";

const { FormSwitchRow, FormText } = Forms;

export default function Settings() {
    useProxy(storage);
    storage.enabled ??= false;
    storage.fakeMute ??= true;
    storage.fakeDeafen ??= true;

    return (
        <>
            <FormSwitchRow
                label="Fake Deafen Active"
                subLabel="Toggle before/during a call. Others see you deafened/muted; your mic stays live."
                value={storage.enabled}
                onValueChange={(v: boolean) => {
                    storage.enabled = v;
                    showToast(v ? "Fake Deafen enabled" : "Fake Deafen disabled");
                }}
            />
            <FormSwitchRow
                label="Broadcast as Muted"
                value={storage.fakeMute}
                onValueChange={(v: boolean) => { storage.fakeMute = v; }}
            />
            <FormSwitchRow
                label="Broadcast as Deafened"
                value={storage.fakeDeafen}
                onValueChange={(v: boolean) => { storage.fakeDeafen = v; }}
            />
            <FormText>
                Flip the switch on, join or stay in a call. Flip it off to go back to normal.
            </FormText>
        </>
    );
}
