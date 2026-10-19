// What the crew and the soldiers say when you talk to them: Russian, with English subtitles.
// Each person has a few lines said in turn; some lines only make sense at certain moments
// (the engine stopped, ice just hit, the aurora overhead, the horn) and are said first when they do.
//
// Every line is recorded (tools/elevenlabs/generate.mjs: public/audio/vo/, one voice per speaker,
// cast in tools/elevenlabs/manifest.json). A recording is matched to its line by the speaker and
// the Russian text, so after changing a line here, run the generator again: until then the line
// falls back to the browser's voice.

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
  ],
  bosun: [
    ['Не стой на линии троса! Лопнет — пополам разрежет.', 'Don\'t stand in the line of the hawser! If it snaps, it\'ll cut you in half.'],
    ['Держись за поручни, качает.', 'Hold on to the rail, she\'s rolling.'],
    ['Этот трос толще моей руки. И то, бывает, рвётся.', 'This rope is thicker than my arm. And even so, sometimes it parts.'],
    ['Видишь моржей на льдине? Здоровые, как бочки.', 'See the walruses on the floe? Big as barrels.'],
  ],
  deckhand: [
    ['Холодно сегодня, а? Минус тридцать, не меньше.', 'Cold tonight, huh? Thirty below, at least.'],
    ['Первый рейс за полярный круг. Красиво, но пальцы не чувствую.', 'My first trip past the Arctic Circle. Beautiful, but I can\'t feel my fingers.'],
    ['Говорят, пингвинов тут не бывает. А вон же они, сидят.', 'They say there are no penguins up here. And yet there they are, sitting.'],
    ['Кок обещал блины к утру.', 'The cook promised pancakes by morning.'],
  ],
  engineer: [
    ['Двигатель работает как часы. Слышишь?', 'The engine runs like a clock. Hear it?'],
    ['Свет в машинном — вот этими выключателями. Только не балуйся.', 'The lights down here are on these switches. Just don\'t play with them.'],
    ['Масло в норме, температура в норме. Значит, и я в норме.', 'Oil normal, temperature normal. So I\'m normal too.'],
    ['Хочешь заглушить машину — красная кнопка. Потом сам заводить будешь.', 'Want to stop the engine? The red button. Then you\'ll start it yourself.'],
  ],
  cook: [
    ['Чай будет скоро. Поставь чайник, раз уж пришёл.', 'Tea soon. Put the kettle on, since you\'re here.'],
    ['На обед борщ. На ужин тоже борщ.', 'Borscht for lunch. Borscht for dinner, too.'],
    ['Радио оставь, пусть играет. Без музыки тоскливо.', 'Leave the radio on, let it play. It\'s dreary without music.'],
    ['Стол я только что вытер. Не ставь на него ничего.', 'I just wiped that table. Don\'t put anything on it.'],
  ],
  soldier1: [
    ['Всё спокойно. Продолжайте.', 'All quiet. Carry on.'],
    ['Пост сдал, пост принял. Ничего интересного, кроме льда.', 'Watch handed over, watch taken. Nothing to report but ice.'],
    ['Вам сюда можно, вам на мостик тоже можно. А вот на нос ночью — осторожно.', 'You can be here, you can go to the bridge too. But the bow at night: careful.'],
  ],
  soldier2: [
    ['Здравия желаю.', 'Good evening, sir.'],
    ['Обход каждые полчаса. Ноги уже не чувствую.', 'A round every half hour. I can\'t feel my feet anymore.'],
    ['Сержант не любит, когда я разговариваю на посту.', 'The sergeant doesn\'t like it when I talk on duty.'],
  ],
  soldier3: [
    ['Смотрю на лёд. Лёд смотрит на меня.', 'I watch the ice. The ice watches me.'],
    ['В бинокль видно моржей. Один на меня смотрит, честно.', 'You can see walruses through the binoculars. One is looking right at me, honestly.'],
    ['Северное сияние сегодня красивое.', 'The northern lights are beautiful tonight.'],
  ],
  soldier4: [
    ['Не подходите близко к корме, там трос.', 'Don\'t get too close to the stern, the hawser\'s there.'],
    ['Дома сейчас тоже снег. Но не такой.', 'There\'s snow at home now too. But not like this.'],
    ['Слышите, как лёд скрипит? Привыкнуть невозможно.', 'Hear the ice creaking? You never get used to it.'],
  ],
};

// moment lines: tried first when the moment is fresh (said once per moment)
export const MOMENTS = {
  engineOff: { who: ['engineer', 'captain', 'bosun'], line: ['Машина встала! Кто нажал кнопку?', 'The engine\'s stopped! Who pressed the button?'] },
  iceHit: { who: ['captain', 'bosun', 'deckhand', 'soldier2'], line: ['Аккуратнее! Так и корпус помять недолго.', 'Easy! That\'s how you dent the hull.'] },
  horn: { who: ['deckhand', 'soldier3', 'cook'], line: ['Вот это гудок! Все моржи проснулись.', 'Now that\'s a horn! Every walrus is awake.'] },
  aurora: { who: ['soldier3', 'deckhand', 'captain'], line: ['Посмотри наверх. Сияние играет.', 'Look up. The aurora is dancing.'] },
  kettle: { who: ['cook'], line: ['Чайник закипел! Наливай.', 'The kettle\'s boiled! Pour yourself one.'] },
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
