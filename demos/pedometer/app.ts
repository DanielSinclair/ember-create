import type { Answer, Sources } from './app.contract.d.ts';

export const grants = 'fs.read app:/data\nfs.write app:/data\ndevice.health-read purpose.health';

// Date receives the UI clock; local midnight respects the device's DST rules.
const sources: Sources = {
  dayBounds: ([epoch]) => {
    const midnight = new Date(epoch);
    midnight.setHours(0, 0, 0, 0);
    const start = midnight.getTime();
    return { start, end: Math.max(epoch, start + 1) };
  },
};

export const answer: Answer = (source, args, store, storage, native) =>
  sources[source](args, store, storage, native);
