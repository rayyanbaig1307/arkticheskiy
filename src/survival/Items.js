// Everything you can carry: each item's names and descriptions in Russian and English, its icon,
// how many of it fit in your pockets, and what using it does. The weapons and the ammunition
// types are described here too, so the HUD and the journal name them the same way.
//
// Icons are inline SVG strings drawn on one 48-unit grid (weapons on a 96 x 40 strip) in one
// monoline style: a 2-unit stroke in currentColor, round joins, a faint fill on the body, so the
// CSS colours them and they stay crisp at any size.
//
// Using an item goes through useItem(id, ctx): it checks the item can help (no medkit at full
// health), applies its effect to the stats, takes one from the inventory and plays a sound.

const F = 'fill="currentColor" fill-opacity=".16"';
const svg = (body, box = '0 0 48 48') =>
  `<svg viewBox="${box}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const letter = (x, y, ch) =>
  `<text x="${x}" y="${y}" fill="currentColor" stroke="none" font-size="7.5" font-weight="700" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif">${ch}</text>`;

const key = (ch) => svg(`<circle cx="14" cy="18" r="6.5" ${F}/><circle cx="14" cy="18" r="2"/>
  <path d="M18.6 22.6L37 41"/><path d="M30.5 34.5l-3.5 3.5M34.5 38.5l-3 3"/>
  <path d="M19.5 13.5l7-2.5"/><rect x="26" y="6" width="15" height="11" rx="1.5" ${F}/>${letter(33.5, 14.3, ch)}`);

const round9 = (x) => `<path d="M${x} 39V26c0-5 1.5-8.2 3.5-9.8 2 1.6 3.5 4.8 3.5 9.8v13z" ${F}/><path d="M${x} 27h7M${x - 0.8} 39h8.6"/>`;
const round54 = (x) => `<path d="M${x} 39V23l1.2-2.6V17c0-4.4.6-7.6 1.3-9.6.7 2 1.3 5.2 1.3 9.6v3.4L${x + 5} 23v16z" ${F}/>`;

export const ICONS = {
  medkit: svg(`<rect x="6" y="15" width="36" height="25" rx="3" ${F}/><path d="M18 15v-4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4"/><path d="M24 21v13M17.5 27.5h13"/>`),
  bandage: svg(`<circle cx="19" cy="22" r="11" ${F}/><circle cx="19" cy="22" r="3.5"/><path d="M19 33h23v-5H28.2"/><path d="M32 30.5h6" stroke-dasharray="1.5 2.5"/>`),
  battery: svg(`<rect x="15" y="10" width="18" height="32" rx="3" ${F}/><path d="M20 10V6.5h8V10"/><path d="M24 17v6M21 20h6M21 35h6"/>`),
  flare: svg(`<g transform="rotate(45 24 24)"><rect x="20" y="16" width="8" height="26" rx="1.5" ${F}/><path d="M20 21h8"/><path d="M21.5 16v-3h5v3"/></g><path d="M35.5 12l2.5-2.5M37.5 17h3.5M31.5 10.5V7"/>`),
  fuel_can: svg(`<path d="M13 9h15l9 9v21a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V12a3 3 0 0 1 3-3z" ${F}/><path d="M15.5 14h8"/><path d="M15 22l15 15M30 22L15 37"/><path d="M31 12.5l3.5-3.5 3 3-3.5 3.5"/>`),
  fuse: svg(`<rect x="13" y="18" width="22" height="12" rx="2" ${F}/><rect x="7" y="16" width="6" height="16" rx="1"/><rect x="35" y="16" width="6" height="16" rx="1"/><path d="M16 24c2-3 4 3 6 0s4 3 6 0 2-1.5 3 0"/>`),
  feeder_cable: svg(`<circle cx="21" cy="21" r="13" ${F}/><circle cx="21" cy="21" r="8.5"/><circle cx="21" cy="21" r="4"/><path d="M32 28c3 2 5 5 5 8"/><rect x="34" y="36" width="6" height="7" rx="1"/><path d="M37 43v2"/>`),
  keycard_gromov: svg(`<rect x="6" y="12" width="36" height="24" rx="2.5" ${F}/><rect x="10" y="16" width="9" height="11" rx="1"/><path d="M12.5 26c0-2 1-3 2-3s2 1 2 3M23 18h14M23 22.5h10M6 31h36"/>`),
  keycard_lab: svg(`<rect x="6" y="12" width="36" height="24" rx="2.5" ${F}/><path d="M12 16h6M13.5 16v3.5L10.5 26h9l-3-6.5V16"/><path d="M23 18h14M23 22.5h10M6 31h36"/>`),
  key_generator: key('Г'),
  key_depot: key('С'),
  key_kennel: key('П'),
  key_radio: key('Р'),
  thermite: svg(`<rect x="13" y="14" width="22" height="27" rx="3" ${F}/><path d="M13 20.5h22M13 35h22"/><path d="M20 14v-4h8v4"/><path d="M28 10c2.5-3 5.5-3 8-.5"/><path d="M24 23.5l4.5 8h-9z"/>`),
  detonator: svg(`<rect x="9" y="24" width="30" height="16" rx="2" ${F}/><path d="M24 24V12M17 12h14"/><circle cx="15" cy="32" r="1.6"/><circle cx="33" cy="32" r="1.6"/><path d="M34.5 32c4 0 7 2 8 6.5"/>`),
  ammo_9x18: svg(`${round9(10.5)}${round9(20.5)}${round9(30.5)}`),
  ammo_762x54: svg(`${round54(8.5)}${round54(15.5)}${round54(22.5)}${round54(29.5)}${round54(36.5)}<path d="M7 39h34v3.5H7z" ${F}/>`),
  ammo_762x39: svg(`<path d="M16 6h11v7c1 9 4.5 16 11 23l-11 6c-6.5-7.5-10-17-11-28z" ${F}/><path d="M16.5 18.5c3.5 0 6.5-.6 10-1.6M19.5 28c3.2-.6 6.3-1.6 9.6-3.2"/><path d="M19 6V3.5h5V6"/>`),
  ammo_flare: svg(`<rect x="9" y="17" width="12" height="21" rx="1.5" ${F}/><path d="M7.5 38.5h15M9 22h12"/><rect x="26" y="12" width="12" height="26" rx="1.5" ${F}/><path d="M24.5 38.5h15M26 17h12"/><circle cx="32" cy="27" r="2.2"/>`),
  vodka: svg(`<path d="M21 6h6v8c0 2 5 4 5 9v17a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2V23c0-5 5-7 5-9z" ${F}/><path d="M21 9.5h6M16 26h16M16 35h16"/>`),
  tea: svg(`<rect x="11" y="14" width="16" height="28" rx="3" ${F}/><path d="M13 14v-4h12v4M11 21h16"/><path d="M30 30h10l-1.5 10h-7z"/><path d="M33 26.5c-1-2 1-3 0-5M37 26.5c-1-2 1-3 0-5"/>`),
  photo: svg(`<g transform="rotate(-6 24 24)"><rect x="8" y="9" width="32" height="30" rx="1" ${F}/><rect x="12" y="13" width="24" height="17"/><circle cx="19.5" cy="19" r="2.5"/><path d="M12 30l8-7 5 4 4-3 7 6"/></g>`),
  tape: svg(`<rect x="6" y="11" width="36" height="25" rx="2" ${F}/><rect x="12" y="17" width="24" height="10" rx="5"/><circle cx="17" cy="22" r="2.4"/><circle cx="31" cy="22" r="2.4"/><path d="M13 36l3-5h16l3 5"/>`),
  parcel: svg(`<rect x="9" y="13" width="30" height="25" rx="2" ${F}/><path d="M9 21h30M20 13v8M28 13v8"/>`),
  // documents, by kind (the journal's list)
  doc_journal: svg(`<rect x="11" y="7" width="26" height="34" rx="2" ${F}/><path d="M16 7v34M21 15h11M21 21h11M21 27h8"/>`),
  doc_note: svg(`<path d="M12 8h20l5 5v27H12z" ${F}/><path d="M32 8v5h5M17 18h14M17 24h14M17 30h9"/>`),
  doc_telex: svg(`<path d="M10 6h28v32l-3.5 3-3.5-3-3.5 3-3.5-3-3.5 3-3.5-3-3.5 3L10 38z" ${F}/><path d="M15 13h18M15 19h18M15 25h12"/>`),
  doc_report: svg(`<rect x="10" y="7" width="28" height="34" rx="1" ${F}/><path d="M15 14h18M15 20h18M15 26h10"/><circle cx="30" cy="33" r="4"/>`),
  doc_poster: svg(`<rect x="9" y="6" width="30" height="36" rx="1" ${F}/><path d="M24 12l2 4.5 5 .5-3.8 3.3 1.2 4.9-4.4-2.7-4.4 2.7 1.2-4.9L17 17l5-.5z"/><path d="M14 31h20M14 36h14"/>`),
  // weapons (a 96 x 40 strip, muzzles to the right)
  pm: svg(`<path d="M30 9h37v8H30z" ${F}/><path d="M32 17h11l-4 15.5a1 1 0 0 1-1 .7h-7.2a1 1 0 0 1-1-1.2z" ${F}/><path d="M41.5 21.5h6a3 3 0 0 0 3-3V17M33.5 12v2M36.5 12v2"/>`, '0 0 96 40'),
  mosin: svg(`<path d="M3 21l24-4h64v4H42l-4 3h-8l-6 8H6a3 3 0 0 1-3-3z" ${F}/><path d="M40 15h53M91 15v-3M28 17v-3h13v3M33 17l2.5 6"/><circle cx="36" cy="24.5" r="1.5"/><path d="M39 24c0 3 2 5 5 5h1.5M56 23.5h30"/>`, '0 0 96 40'),
  akm: svg(`<path d="M28 14L5 18v12l23-6z" ${F}/><rect x="28" y="12" width="30" height="10" rx="1" ${F}/><path d="M58 14h18v8H58z" ${F}/><path d="M58 12h18M76 17h16M86 17v-4M91 15.5v3"/><path d="M35 22l-3 10h5.5l3-10" ${F}/><path d="M45 22h9c0 6 2.5 10.5 6 13.5l-6.5 3.5C49 35 46 29.5 45 22z" ${F}/>`, '0 0 96 40'),
  flaregun: svg(`<rect x="36" y="9" width="40" height="12" rx="2" ${F}/><path d="M73 9v12"/><path d="M33 11h11v10h-1l-4.5 13.4a1 1 0 0 1-1 .6h-7.3a1 1 0 0 1-.95-1.3L33 21z" ${F}/><path d="M33 12l-3.5-3M44 21v2.5a3 3 0 0 0 3 3h5v-5.5"/>`, '0 0 96 40'),
};

const t = (ru, en) => ({ ru, en });

// kind: 'use' (consumed from the journal or a key), 'ammo' (turns into loose rounds), 'flare'
// (thrown with G), 'key', 'tool' (story parts), 'story' (photos, tapes)
// stack: the most you can carry; use: the effect (heal, battery, warm, calm)
export const ITEMS = {
  medkit: { kind: 'use', stack: 4, use: { heal: 55 }, name: t('Аптечка', 'Medkit'),
    desc: t('Армейская аптечка: бинты, жгут, шприц-тюбик промедола. Возвращает много здоровья. Клавиша H.',
      'An army first-aid kit: dressings, a tourniquet, a promedol syrette. Restores a lot of health. Press H.') },
  bandage: { kind: 'use', stack: 6, use: { heal: 18 }, name: t('Бинт', 'Bandage'),
    desc: t('Стерильный бинт в бумажной обёртке. Немного здоровья.', 'A sterile dressing in its paper wrapper. Restores a little health.') },
  battery: { kind: 'use', stack: 6, use: { battery: 100 }, name: t('Батарейка', 'Battery'),
    desc: t('Батарейка для фонаря. Полный заряд: минуты четыре света.', 'A battery for the flashlight. A full charge: about four minutes of light.') },
  flare: { kind: 'flare', stack: 6, name: t('Фальшфейер', 'Hand flare'),
    desc: t('Красный сигнальный огонь. Клавиша G: зажечь и бросить. Горит около минуты; Тени его сторонятся.',
      'A red signal flare. Press G to light and throw it. Burns for about a minute; the Shades keep away from it.') },
  vodka: { kind: 'use', stack: 3, use: { warm: 28, calm: 0.3 }, name: t('Водка', 'Vodka'),
    desc: t('«Столичная», полбутылки. Греет изнутри: недолго, зато сразу. И руки меньше дрожат.',
      'Half a bottle of Stolichnaya. Warms you from the inside: not for long, but at once. Steadies the hands.') },
  tea: { kind: 'use', stack: 3, use: { warm: 45, calm: 0.1 }, name: t('Термос с чаем', 'Thermos of tea'),
    desc: t('Крепкий сладкий чай, ещё горячий. Хорошо согревает.', 'Strong sweet tea, still hot. Warms you right through.') },

  ammo_9x18: { kind: 'ammo', ammo: { type: '9x18', rounds: 16 }, name: t('Патроны 9×18', '9×18 mm rounds'),
    desc: t('Коробка патронов к пистолету Макарова, шестнадцать штук.', 'A box of sixteen rounds for the Makarov.') },
  ammo_762x54: { kind: 'ammo', ammo: { type: '7.62x54R', rounds: 10 }, name: t('Патроны 7,62×54R', '7.62×54R rounds'),
    desc: t('Две обоймы по пять патронов к карабину Мосина.', 'Two five-round stripper clips for the Mosin carbine.') },
  ammo_762x39: { kind: 'ammo', ammo: { type: '7.62x39', rounds: 30 }, name: t('Патроны 7,62×39', '7.62×39 mm rounds'),
    desc: t('Тридцать патронов к автомату Калашникова.', 'Thirty rounds for the Kalashnikov.') },
  ammo_flare: { kind: 'ammo', ammo: { type: 'flare', rounds: 3 }, name: t('Сигнальные патроны', 'Flare cartridges'),
    desc: t('Три 26-миллиметровых патрона к ракетнице.', 'Three 26 mm cartridges for the flare pistol.') },

  fuel_can: { kind: 'tool', stack: 1, name: t('Канистра солярки', 'Fuel can'),
    desc: t('Двадцать литров дизельного топлива со склада ГСМ. Для генератора.', 'Twenty litres of diesel from the fuel depot. For the generator.') },
  fuse: { kind: 'tool', stack: 2, name: t('Предохранитель', 'Fuse'),
    desc: t('Плавкий предохранитель из мастерской. Генератору нужен новый.', 'A cartridge fuse from the workshop. The generator needs a new one.') },
  feeder_cable: { kind: 'tool', stack: 1, name: t('Фидер', 'Feeder cable'),
    desc: t('Моток коаксиального кабеля. Хватит, чтобы заменить перерезанный фидер антенны.', 'A coil of coaxial cable, enough to replace the antenna\'s cut feeder.') },
  keycard_gromov: { kind: 'key', stack: 1, name: t('Пропуск Громова', 'Gromov\'s keycard'),
    desc: t('Пропуск начальника станции. Открывает кабинет и лабораторию.', 'The station chief\'s pass card. Opens his office and the lab.') },
  keycard_lab: { kind: 'key', stack: 1, name: t('Пропуск лаборатории', 'Lab keycard'),
    desc: t('Пропуск в гляциологическую лабораторию.', 'A pass card for the glaciology lab.') },
  key_generator: { kind: 'key', stack: 1, name: t('Ключ от генераторной', 'Generator hut key'),
    desc: t('Ключ на бирке с буквой «Г».', 'A key on a tag marked Г, for the generator hut.') },
  key_depot: { kind: 'key', stack: 1, name: t('Ключ от склада ГСМ', 'Fuel depot key'),
    desc: t('Ключ на бирке с буквой «С»: склад горюче-смазочных материалов.', 'A key on a tag marked С, for the fuel depot.') },
  key_kennel: { kind: 'key', stack: 1, name: t('Ключ от псарни', 'Kennel key'),
    desc: t('Ключ на бирке с буквой «П».', 'A key on a tag marked П, for the kennel.') },
  key_radio: { kind: 'key', stack: 1, name: t('Ключ от радиорубки', 'Radio room key'),
    desc: t('Ключ на бирке с буквой «Р».', 'A key on a tag marked Р, for the radio room.') },
  thermite: { kind: 'tool', stack: 3, name: t('Термитный заряд', 'Thermite charge'),
    desc: t('Термитная шашка с запалом. Нужно три: по одной на каждую ледяную колонну.', 'A thermite charge with an igniter. Three are needed: one for each ice pillar.') },
  detonator: { kind: 'tool', stack: 1, name: t('Подрывная машинка', 'Detonator'),
    desc: t('Ручная подрывная машинка: провода, ручка, и надежда.', 'A hand-cranked blasting machine: wires, a handle, and hope.') },
};

// photo_* and tape_* are story props, described by the story when it registers them; until then
// they get a generic name
const PREFIXES = {
  photo_: { kind: 'story', stack: 1, icon: 'photo', name: t('Фотография', 'Photograph'), desc: t('Старая фотография.', 'An old photograph.') },
  tape_: { kind: 'story', stack: 1, icon: 'tape', name: t('Кассета', 'Tape'), desc: t('Магнитофонная кассета.', 'An audio cassette.') },
};

export function registerItem(id, def) { ITEMS[id] = { kind: 'story', stack: 1, ...def }; }

export function itemDef(id) {
  let d = ITEMS[id];
  if (!d) {
    const p = Object.keys(PREFIXES).find((k) => id.startsWith(k));
    d = { kind: 'tool', stack: 99, name: t(id, id), desc: t('', ''), ...(p ? PREFIXES[p] : {}) };
  }
  return { id, ...d, iconSvg: ICONS[d.icon || id] || ICONS.parcel };
}

export const iconFor = (id) => itemDef(id).iconSvg;

// the order the journal lays them out in
const KIND_ORDER = ['use', 'flare', 'ammo', 'key', 'tool', 'story'];
export const kindRank = (id) => KIND_ORDER.indexOf(itemDef(id).kind);

export const WEAPONS = {
  pm: { ammo: '9x18', mag: 8, name: t('ПМ', 'Makarov PM'),
    desc: t('Пистолет Макарова, восемь патронов в магазине. Сержант Орлов отдал его «для медведей».', 'The Makarov pistol, eight rounds to a magazine. Sergeant Orlov gave it to you "for the bears".') },
  mosin: { ammo: '7.62x54R', mag: 5, name: t('Карабин Мосина', 'Mosin-Nagant M44'),
    desc: t('Пять патронов, обоймой; затвор медленный. Бьёт наповал.', 'Five rounds, loaded by the clip; the bolt is slow. It hits hard.') },
  akm: { ammo: '7.62x39', mag: 30, name: t('АКМ', 'AKM'),
    desc: t('Автомат Орлова. Тридцать патронов в магазине.', 'Orlov\'s rifle. Thirty rounds to a magazine.') },
  flaregun: { ammo: 'flare', mag: 1, name: t('СПШ-44', 'SPSh-44 flare pistol'),
    desc: t('Сигнальный пистолет. Пугает медведей, жжёт Обращённых, освещает тьму.', 'A signal pistol. Scares bears, burns the Turned, lights the dark.') },
};

export const AMMO = {
  '9x18': t('9×18', '9×18 mm'),
  '7.62x54R': t('7,62×54R', '7.62×54R'),
  '7.62x39': t('7,62×39', '7.62×39 mm'),
  flare: t('26 мм', '26 mm flare'),
};

// can this item help right now? { ok, why }
export function canUse(id, { stats, inventory }) {
  const d = itemDef(id);
  if (!d.use) return { ok: false, why: d.kind === 'flare' ? t('Клавиша G в игре', 'Press G in play') : null };
  if (inventory && !inventory.has(id)) return { ok: false, why: t('Нет', 'None left') };
  if (!stats || stats.dead) return { ok: false, why: null };
  const u = d.use;
  const helps = (u.heal && stats.health < 99.5) || (u.battery && stats.battery < 99.5) || (u.warm && stats.warmth < 99.5);
  if (helps) return { ok: true, why: null };
  if (u.heal) return { ok: false, why: t('Ты не ранен', 'You are not hurt') };
  if (u.battery) return { ok: false, why: t('Батарейка ещё полная', 'The battery is still full') };
  return { ok: false, why: t('Тебе не холодно', 'You are not cold') };
}

// use one: the effect, one fewer in the pockets, a sound. Returns true if it was used.
export function useItem(id, { inventory, stats, hud, audio } = {}) {
  const d = itemDef(id);
  if (!canUse(id, { stats, inventory }).ok) return false;
  const u = d.use;
  if (u.heal) stats.heal(u.heal);
  if (u.battery) stats.refillBattery(u.battery);
  if (u.warm) stats.warm(u.warm);
  if (u.calm) stats.calm(u.calm);
  inventory.remove(id, 1);
  audio?.horror?.sfx?.(u.battery ? 'pickup_ammo' : 'pickup', null, { gain: 0.7 });
  hud?.used?.(id);
  return true;
}

// H: the medkit, or a bandage when the medkits are gone
export function quickHeal(ctx) {
  const { inventory, stats, hud } = ctx;
  if (!stats || stats.dead) return false;
  for (const id of ['medkit', 'bandage']) if (inventory.has(id) && useItem(id, ctx)) return true;
  if (!inventory.has('medkit') && !inventory.has('bandage')) hud?.toast?.('Нет аптечки', 'No medkit');
  else hud?.toast?.('Ты не ранен', 'You are not hurt');
  return false;
}
