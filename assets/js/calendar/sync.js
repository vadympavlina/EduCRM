// ============================================================
//  calendar/sync.js — живе оновлення спільного стану (store)
//  Вчителі, групові події, блокування — повністю;
//  індивідуальні заняття і разові блокування — від початку
//  минулого місяця (або раніше — через ensure()).
// ============================================================

import { db, ref, onValue, query, orderByChild, startAt } from '../core/firebase.js';
import { isoDate } from '../core/format.js';
import { toast } from '../ui/toast.js';
import { store } from './store.js';

const monthBefore = d => isoDate(new Date(d.getFullYear(), d.getMonth() - 1, 1));

/** onChange(what) викликається після кожного оновлення: 'people' | 'groups' | 'blocks' | 'events' | 'busy' */
export function startSync(onChange) {
  const loaded = { people: false, groups: false, events: false, blocks: false };
  let from = monthBefore(new Date());
  const unsub = {};

  onValue(ref(db, 'people'), s => { store.teachers = s.val() || {}; loaded.people = true; onChange('people'); });
  onValue(ref(db, 'groupEvents'), s => {
    const next = {};
    s.forEach(c => { next[c.key] = { id: c.key, ...c.val() }; });
    store.groupEvents = next; loaded.groups = true; onChange('groups');
  });
  onValue(ref(db, 'settings/blockedTimes'), s => { store.blockedTimes = s.val() || {}; loaded.blocks = true; onChange('blocks'); });

  function subscribeRange() {
    unsub.events?.(); unsub.busy?.();
    unsub.events = onValue(query(ref(db, 'events'), orderByChild('date'), startAt(from)), s => {
      const next = {};
      s.forEach(c => { next[c.key] = { id: c.key, ...c.val() }; });
      store.events = next; loaded.events = true; onChange('events');
    }, err => { console.error(err); toast('Не вдалося завантажити заняття', 'error'); });
    unsub.busy = onValue(query(ref(db, 'busySlots'), orderByChild('date'), startAt(from)), s => {
      store.busySlots = s.val() || {}; onChange('busy');
    });
  }
  subscribeRange();

  return {
    loaded,
    get from() { return from; },
    /** Підвантажити дані, починаючи з місяця перед датою d. */
    ensure(d) {
      const f = monthBefore(d);
      if (f < from) { from = f; loaded.events = false; subscribeRange(); }
    },
  };
}
