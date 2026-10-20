// What the crew and the soldiers say when you talk to them: Russian, with English subtitles.
// Each person has a few lines said in turn; some lines only make sense at certain moments
// (the engine stopped, ice just hit, the aurora overhead, the horn) and are said first when they do.
//
// Every line is recorded (tools/elevenlabs/generate.mjs: public/audio/vo/, one voice per speaker,
// cast in tools/elevenlabs/manifest.json). A recording is matched to its line by the speaker and
// the Russian text, so after changing a line here, run the generator again: until then the line
// falls back to the browser's voice.

import { SCRIPT, SPEAKERS } from '../story/Script.js';

export const CAST = {
  captain:  { name: 'Captain Volkov', ru: 'Капитан Волков', pitch: 0.85, rate: 0.95 },
  bosun:    { name: 'Bosun Petrov', ru: 'Боцман Петров', pitch: 0.8, rate: 1.0 },
  deckhand: { name: 'Lyosha', ru: 'Лёша', pitch: 1.1, rate: 1.1 },
  engineer: { name: 'Chief Engineer Kuznetsov', ru: 'Стармех Кузнецов', pitch: 0.9, rate: 1.0 },
  cook:     { name: 'Semyonych', ru: 'Семёныч', pitch: 0.95, rate: 0.95 },
  soldier1: { name: 'Sergeant Orlov', ru: 'Сержант Орлов', pitch: 0.9, rate: 1.0 },
  soldier2: { name: 'Private Belov', ru: 'Рядовой Белов', pitch: 1.05, rate: 1.05 },
  soldier3: { name: 'Private Akhmetov', ru: 'Рядовой Ахметов', pitch: 1.0, rate: 1.0 },
  soldier4: { name: 'Private Smirnov', ru: 'Рядовой Смирнов', pitch: 1.08, rate: 1.05 },
};

// [russian, english]
export const LINES = {
  captain: [
    ['Добро пожаловать на мостик. Руками ничего не трогай... шучу. Хочешь порулить, бери штурвал.', 'Welcome to the bridge. Don\'t touch anything... I\'m joking. Want to steer? Take the wheel.'],
    ['Лёд сегодня тяжёлый. Держим средний ход, не торопимся.', 'Heavy ice tonight. We hold half ahead, no hurry.'],
    ['Тридцать лет хожу по Северу, а сияние до сих пор не надоело.', 'Thirty years in the North, and I\'m still not tired of the northern lights.'],
    ['Прожектор на крыше. Пульт справа от штурвала.', 'The searchlight is on the roof. The control is right of the wheel.'],
    ['Айсберги обходим, не таранить. Мы ледокол, а не дурак.', 'We go round the bergs, we don\'t ram them. We\'re an icebreaker, not a fool.'],
    ['Громов двадцать лет выходил на связь минута в минуту. А теперь молчит.', 'For twenty years Gromov came on the air to the minute. And now he\'s silent.'],
    ['Про Объект-7 на Диксоне болтают давно. Я в эти байки не верю. Но на купол не полез бы.', 'They\'ve talked about Object 7 at Dikson for years. I don\'t believe those tales. But I wouldn\'t go up on that ice cap.'],
    ['Ящики у пограничников опечатаны. В трюм не дали, держат при себе. Будто они могут уйти.', 'The soldiers\' crates are sealed. They wouldn\'t let them go in the hold, they keep them by them. As if they might walk off.'],
    ['Увидишь ночью на льду человека — не свети на него. Запиши время и позови меня.', 'If you see a man on the ice at night, don\'t put the light on him. Write down the time and call me.'],
  ],
  bosun: [
    ['Не стой на линии троса! Лопнет — пополам разрежет.', 'Don\'t stand in the line of the hawser! If it snaps, it\'ll cut you in half.'],
    ['Держись за поручни, качает.', 'Hold on to the rail, she\'s rolling.'],
    ['Этот трос толще моей руки. И то, бывает, рвётся.', 'This rope is thicker than my arm. And even so, sometimes it parts.'],
    ['Видишь моржей на льдине? Здоровые, как бочки.', 'See the walruses on the floe? Big as barrels.'],
    ['Мне дед рассказывал: при Хрущёве на этот остров завезли целый полк. Обратно не вывезли никого.', 'My grandfather told me: under Khrushchev they shipped a whole regiment to that island. Not one of them was ever shipped back.'],
    ['Слышишь, как тихо? Ни чаек, ни моржей. Всё живое от острова ушло.', 'Hear how quiet it is? No gulls, no walruses. Everything alive has left the island.'],
    ['Канаты на морозе звенят. А ночью один звенел, когда его никто не трогал.', 'Ropes ring in the frost. But last night one was ringing with nobody touching it.'],
  ],
  deckhand: [
    ['Холодно сегодня, а? Минус тридцать, не меньше.', 'Cold tonight, huh? Thirty below, at least.'],
    ['Первый рейс за полярный круг. Красиво, но пальцы не чувствую.', 'My first trip past the Arctic Circle. Beautiful, but I can\'t feel my fingers.'],
    ['Говорят, пингвинов тут не бывает. А вон же они, сидят.', 'They say there are no penguins up here. And yet there they are, sitting.'],
    ['Кок обещал блины к утру.', 'The cook promised pancakes by morning.'],
    ['Ночью на корме меня кто-то звал со льда. По имени. Боцман говорит — ветер. Ветер не знает, как меня зовут.', 'Last night on the stern someone called me from the ice. By name. The bosun says it was the wind. The wind doesn\'t know my name.'],
    ['На «Северном» радистка молодая, Лена. Я с ней летом по рации болтал. Смешная, всё время считает.', 'The radio operator at Severny is a young girl, Lena. I chatted with her on the radio in the summer. Funny, always counting.'],
    ['Минус сорок, я дышу — и пар. И у солдат пар, я проверял. Я теперь всем на рот смотрю.', 'Forty below, I breathe, and there\'s steam. The soldiers steam too, I checked. I watch everyone\'s mouth now.'],
  ],
  engineer: [
    ['Двигатель работает как часы. Слышишь?', 'The engine runs like a clock. Hear it?'],
    ['Свет в машинном — вот этими выключателями. Только не балуйся.', 'The lights down here are on these switches. Just don\'t play with them.'],
    ['Масло в норме, температура в норме. Значит, и я в норме.', 'Oil normal, temperature normal. So I\'m normal too.'],
    ['Хочешь заглушить машину — красная кнопка. Потом сам заводить будешь.', 'Want to stop the engine? The red button. Then you\'ll start it yourself.'],
    ['Машина у меня как часы. А свет мигает. И чем ближе к острову, тем чаще.', 'My engine runs like a clock. But the lights flicker. And the closer we get to the island, the more they do it.'],
    ['В машинном теплее всего на судне. Если что — прячься здесь, у дизеля. Холод сюда не доберётся.', 'The engine room\'s the warmest place aboard. If anything happens, hide down here by the diesel. The cold won\'t get this far.'],
    ['Запомни, как заводить, мало ли: воздух, топливо, пуск. Воздух, топливо, пуск.', 'Remember how to start her, just in case: air, fuel, start. Air, fuel, start.'],
  ],
  cook: [
    ['Чай будет скоро. Поставь чайник, раз уж пришёл.', 'Tea soon. Put the kettle on, since you\'re here.'],
    ['На обед борщ. На ужин тоже борщ.', 'Borscht for lunch. Borscht for dinner, too.'],
    ['Радио оставь, пусть играет. Без музыки тоскливо.', 'Leave the radio on, let it play. It\'s dreary without music.'],
    ['Стол я только что вытер. Не ставь на него ничего.', 'I just wiped that table. Don\'t put anything on it.'],
    ['Солдатам накладываю отдельно, они сами просили. Едят молча, ложкой не звякнут. Как на поминках.', 'I serve the soldiers separately, they asked me to. They eat in silence, never clink a spoon. Like at a wake.'],
    ['Везу Тамаре Ивановне на «Северный» посылку от сестры. Пирог там, наверно, уже камнем стал.', 'I\'m taking Tamara Ivanovna at Severny a parcel from her sister. The pie in it has probably turned to stone by now.'],
    ['Приёмник ночью сам включился. Я выключил. А он опять шипит.', 'The set switched itself on in the night. I switched it off. And it\'s hissing again.'],
  ],
  soldier1: [
    ['Всё спокойно. Продолжайте.', 'All quiet. Carry on.'],
    ['Пост сдал, пост принял. Ничего интересного, кроме льда.', 'Watch handed over, watch taken. Nothing to report but ice.'],
    ['Вам сюда можно, вам на мостик тоже можно. А вот на нос ночью — осторожно.', 'You can be here, you can go to the bridge too. But the bow at night: careful.'],
    ['Про груз вопросов не задавать. Это не я придумал.', 'No questions about the cargo. It wasn\'t my idea.'],
    ['Три года на северных заставах. Такой тишины не слышал.', 'Three years on northern outposts. I never heard a silence like this.'],
    ['Мои ребята боятся медведей. Пусть боятся медведей. Медведь — это понятно.', 'My lads are scared of bears. Let them be scared of bears. A bear you can understand.'],
  ],
  soldier2: [
    ['Здравия желаю.', 'Good evening, sir.'],
    ['Обход каждые полчаса. Ноги уже не чувствую.', 'A round every half hour. I can\'t feel my feet anymore.'],
    ['Сержант не любит, когда я разговариваю на посту.', 'The sergeant doesn\'t like it when I talk on duty.'],
    ['Сержант конверт в нагрудном кармане носит. Даже спит с ним.', 'The sergeant carries an envelope in his breast pocket. Even sleeps with it.'],
    ['Говорят, за этот рейс отпуск дадут. Если вернёмся, говорят. Шутят так.', 'They say we\'ll get leave for this trip. If we come back, they say. That\'s their idea of a joke.'],
  ],
  soldier3: [
    ['Смотрю на лёд. Лёд смотрит на меня.', 'I watch the ice. The ice watches me.'],
    ['В бинокль видно моржей. Один на меня смотрит, честно.', 'You can see walruses through the binoculars. One is looking right at me, honestly.'],
    ['Северное сияние сегодня красивое.', 'The northern lights are beautiful tonight.'],
    ['Вчера в бинокль видел на льду следы. Босые. И все к острову.', 'Yesterday I saw tracks on the ice through the binoculars. Bare feet. All heading for the island.'],
    ['Бабушка моя говорила: настоящая тишина — это когда кто-то слушает.', 'My grandmother used to say: real silence is when someone is listening.'],
  ],
  soldier4: [
    ['Не подходите близко к корме, там трос.', 'Don\'t get too close to the stern, the hawser\'s there.'],
    ['Дома сейчас тоже снег. Но не такой.', 'There\'s snow at home now too. But not like this.'],
    ['Слышите, как лёд скрипит? Привыкнуть невозможно.', 'Hear the ice creaking? You never get used to it.'],
    ['В наших ящиках не патроны. Патроны так не пахнут. Пахнет, как от сварки.', 'It isn\'t cartridges in our crates. Cartridges don\'t smell like that. It smells like welding.'],
    ['Мама пишет: в Вологде минус пятнадцать, все мёрзнут. Я ей не пишу, сколько здесь.', 'Mum writes that it\'s fifteen below in Vologda and everyone\'s freezing. I don\'t tell her what it is here.'],
  ],
};

// moment lines: tried first when the moment is fresh (said once per moment)
export const MOMENTS = {
  engineOff: { who: ['engineer', 'captain', 'bosun'], line: ['Машина встала! Кто нажал кнопку?', 'The engine\'s stopped! Who pressed the button?'] },
  iceHit: { who: ['captain', 'bosun', 'deckhand', 'soldier2'], line: ['Аккуратнее! Так и корпус помять недолго.', 'Easy! That\'s how you dent the hull.'] },
  horn: { who: ['deckhand', 'soldier3', 'cook'], line: ['Вот это гудок! Все моржи проснулись.', 'Now that\'s a horn! Every walrus is awake.'] },
  aurora: { who: ['soldier3', 'deckhand', 'captain'], line: ['Посмотри наверх. Сияние играет.', 'Look up. The aurora is dancing.'] },
  kettle: { who: ['cook'], line: ['Чайник закипел! Наливай.', 'The kettle\'s boiled! Pour yourself one.'] },
  // the horror's moments aboard (chapters 1 and 5)
  radarDead: { who: ['captain', 'soldier3'], line: ['Радар ослеп. Теперь только глазами да прожектором.', 'The radar\'s blind. It\'s eyes and the searchlight now.'] },
  lightsOut: { who: ['deckhand', 'cook', 'soldier2'], line: ['Свет! Кто выключил свет?', 'The lights! Who turned the lights off?'] },
  knock: { who: ['engineer', 'deckhand', 'soldier4'], line: ['Опять стучат. Снизу. Три раза.', 'They\'re knocking again. From below. Three times.'] },
  radioVoice: { who: ['cook', 'deckhand', 'soldier2'], line: ['Это опять она. Считает. Выключи ты его, ради бога.', 'That\'s her again. Counting. For God\'s sake, switch it off.'] },
  deadBear: { who: ['bosun', 'soldier3', 'deckhand'], line: ['Видел медведя на льдине? Кто-то его вывернул наизнанку.', 'See the bear on that floe? Something turned it inside out.'] },
  figure: { who: ['soldier3', 'captain', 'bosun'], line: ['Там кто-то стоит на льду. Без шапки. В минус сорок.', 'Someone\'s standing out on the ice. No hat. At forty below.'] },
  stationDark: { who: ['captain', 'bosun', 'soldier4'], line: ['Ни огонька на станции. Как будто там никогда никого не было.', 'Not one light at the station. As if no one had ever been there.'] },
  cold: { who: ['deckhand', 'soldier2', 'cook'], line: ['Холодно-то как. Будто мороз прямо сквозь борт идёт.', 'God, it\'s cold. As if the frost were coming straight through the hull.'] },
};

// the run to Station Severny (story/Story.js): [who, russian, english], said once each (fast and
// chief2 again when they come round again)
export const STORY = {
  intro: ['captain', 'Штурман, станция «Северный» ждёт нас: продукты, топливо, почта на всю зиму. Бери штурвал, поведёшь.', 'Navigator, Station Severny is waiting for us: food, fuel, mail for the whole winter. Take the wheel, you\'re steering.'],
  helm: ['captain', 'Курс на «Северный»: норд-норд-ост, два с половиной километра. Крупные льдины обходи, мелочь дави.', 'Course for Severny: north-north-east, two and a half kilometres. Go round the big floes, push the small stuff aside.'],
  auto: ['captain', 'Ладно, старпом подержит курс. Перед подходом вернись на мостик.', 'All right, the mate will hold the course. Come back to the bridge before the approach.'],
  radio: ['radio', '«Полярник», «Полярник», я «Северный». Видим ваши огни. Причал свободен, лёд у кромки крепкий.', 'Polyarnik, Polyarnik, this is Severny. We see your lights. The berth is clear, the ice at the edge is solid.'],
  approach: ['captain', 'Сбавь ход до малого. Подходим правым бортом, носом на запад. Видишь огни на причале?', 'Ease her down to slow ahead. We go alongside starboard side to, bow to the west. See the lights on the berth?'],
  handover: ['captain', 'Дальше сам, штурман. Подводи к причалу, малым ходом.', 'From here she\'s yours, navigator. Bring her to the berth, dead slow.'],
  fast: ['captain', 'Тише, тише! Не тарань причал, сбавь ход.', 'Easy, easy! Don\'t ram the berth, take the way off her.'],
  docking: ['captain', 'Стоп машина! Боцман, подать концы!', 'Stop engine! Bosun, lines ashore!'],
  moored: ['captain', 'Пришвартовались. Молодец. Сходи на лёд, начальник станции ждёт.', 'We\'re moored. Well done. Go ashore, the station chief is waiting for you.'],
  chief: ['chief', 'Добро пожаловать на «Северный»! Две недели вас ждали. Мука кончилась, а табак ещё раньше. Спасибо, моряки!', 'Welcome to Severny! We\'ve waited two weeks for you. The flour ran out, and the tobacco before it. Thank you, sailors!'],
  chief2: ['chief', 'Заходите греться, чай на плите. Только сапоги отряхните.', 'Come in and warm up, the tea\'s on the stove. Just knock the snow off your boots.'],
  castoff: ['captain', 'Отдать концы! Ну что, обратно во льды.', 'Let go the lines! Well then, back into the ice.'],
};
export const STORY_CAST = {
  captain: { name: 'Captain Volkov', pitch: 0.85, rate: 0.95 },
  radio: { name: 'Severny (radio)', pitch: 1.05, rate: 1.05 },
  chief: { name: 'Station chief Gromov', pitch: 0.78, rate: 0.92 },
};

// The chapters' script (story/Script.js) is recorded with the rest: the voice generator reads
// STORY, so the script's lines join it here under their own ids (story_c1_brief_1.mp3 ...), and
// its new speakers join STORY_CAST. The old keys above are left as they are.
for (const [id, line] of Object.entries(SCRIPT)) if (!(id in STORY)) STORY[id] = line;
for (const [who, v] of Object.entries(SPEAKERS)) if (!(who in STORY_CAST)) STORY_CAST[who] = v;
