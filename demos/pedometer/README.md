# Stride pedometer demo

Stride reads today's step total through Exact's `@exact/health` package, backed
by HealthKit on iOS. It requests only Steps, after the person presses Connect
Apple Health. It does not write health records, transmit them, or save a copy.

The day begins at local calendar midnight, including daylight-saving changes.
The query refreshes each minute, on Refresh, and on the package's health-store
notifications. A reported zero is shown as zero; no visible samples have a
separate empty state. HealthKit does not reveal read authorization, so the UI
never infers denial from an empty result.

This demo was authored directly to exercise the native HealthKit integration;
its contract is not presented as Muse-generated. No fixture steps are included
in the app. A simulator with no health data can legitimately show no samples.
Real-device authorization and agreement with Apple Health require verification
on a test device with known data.

The shared container must include `@exact/health`, the `device.health-read
purpose.health` grant, and the localized `purpose.health` explanation before its
native build. Exact derives the HealthKit entitlement and purpose strings.
Changing this capability requires one native rebuild; later compatible Contract
edits use the existing development stream.
