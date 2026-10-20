// Every spoken line of the chapters (CONTRACTS.md, "Story lines"): [speaker, russian, english].
// Ids are <chapter>_<beat>_<n>; a beat's lines are said in order (BEATS lists them). The player
// never speaks.
//
// Speakers: the crew and soldiers (characters/Lines.js CAST), 'radio' (Dikson Radio), and the new
// voices in SPEAKERS below. The Guest speaks in other people's voices: its lines are given to the
// voice it is using (Orlov's, the captain's, Lyosha's...), and MIMICKED lists them so they can be
// played wrong (through the radio's static, or a little slow). 'mimic' is the Guest in Markova's
// voice, when it slips; 'gromov' is Gromov Turned; 'chief_tape' is Gromov alive, on his cassette.
//
// A recording is found by its speaker and its Russian text (audio/Voices.js), so a line that
// repeats an existing line word for word (c2_false_1, c3_voices_4, c5_aboard_2..5) plays the
// clip already recorded: the crew's own words, coming back wrong.

export const SPEAKERS = {
  gromov:     { name: 'Gromov', ru: 'Громов', pitch: 0.7, rate: 0.75 },
  sokolov:    { name: 'Colonel Sokolov (recording)', ru: 'Полковник Соколов', pitch: 0.82, rate: 0.9 },
  mimic:      { name: 'The voice', ru: 'Голос', pitch: 1.1, rate: 0.85 },
  markova:    { name: 'Elena Markova (radio)', ru: 'Елена Маркова', pitch: 1.2, rate: 1.0 },
  chief_tape: { name: 'Gromov (cassette)', ru: 'Громов (запись)', pitch: 0.8, rate: 0.95 },
  radio:      { name: 'Dikson Radio', ru: 'Диксон-радио', pitch: 1.0, rate: 1.0 },
};

export const SCRIPT = {
  // =========================================================================================
  // 1. МОЛЧАНИЕ: at sea, aboard the Polyarnik
  // =========================================================================================

  // the tug's radio, at the start
  c1_dikson_1: ['radio', '«Полярник», я Диксон-радио. «Северный» на связь не выходит. Следуйте по назначению, докладывайте каждые сутки.', 'Polyarnik, this is Dikson Radio. Severny is still not answering. Proceed as ordered and report every twenty-four hours.'],

  // the captain's briefing on the bridge
  c1_brief_1: ['captain', 'Второй, зайди. Слушай внимательно, повторять не буду.', 'Second, come in. Listen carefully, I won\'t say it twice.'],
  c1_brief_2: ['captain', '«Северный» молчит восьмые сутки. Ни сводок, ни ответа на вызовы.', 'Severny has been silent for eight days. No weather reports, no answer to our calls.'],
  c1_brief_3: ['captain', 'Везём им муку, солярку и почту. И сержанта Орлова с его людьми. Зачем — не спрашивай, мне тоже не сказали.', 'We\'re bringing them flour, diesel and the mail. And Sergeant Orlov and his men. Don\'t ask me why. Nobody told me either.'],
  c1_brief_4: ['captain', 'Громова я знаю двадцать лет. Он бы не молчал. Значит, у них беда.', 'I\'ve known Gromov twenty years. He wouldn\'t go quiet. So they\'re in trouble.'],
  c1_brief_5: ['captain', 'Завтра к вечеру будем у острова. На берег с Орловым пойдёшь ты: ты видел схему станции. Боцман пойдёт с вами.', 'We\'ll be off the island tomorrow evening. You go ashore with Orlov: you\'ve seen the station\'s plan. The bosun goes with you.'],
  c1_brief_6: ['captain', 'А пока — твоя вахта. Держи курс и смотри на лёд.', 'Until then it\'s your watch. Hold the course and watch the ice.'],

  // Orlov hands over the Makarov
  c1_pm_1: ['soldier1', 'Второй помощник? Сержант Орлов. Возьмите.', 'Second mate? Sergeant Orlov. Take this.'],
  c1_pm_2: ['soldier1', 'Пистолет Макарова, восемь патронов в магазине. Это от медведей.', 'A Makarov, eight rounds in the magazine. It\'s for the bears.'],
  c1_pm_3: ['soldier1', 'На берегу держитесь за мной. Скажу «назад» — бегом назад и не оглядываться.', 'Ashore, you stay behind me. If I say "back", you run back and don\'t look round.'],
  c1_pm_4: ['soldier1', 'И ещё. Если со станции вас позовут по имени — не отвечайте.', 'And one more thing. If anyone at the station calls you by name, don\'t answer.'],

  // the radar dies: a fuse in the engine room; the lights go on the way down
  c1_radar_1: ['captain', 'Радар погас. Второй, спустись в машинное, глянь щит. Кузнецов там.', 'The radar\'s gone dark. Second, go down to the engine room and look at the switchboard. Kuznetsov\'s down there.'],
  c1_radar_2: ['engineer', 'Опять предохранитель. Вторую ночь подряд. Запасные в ящике на щите, верхний ряд.', 'The fuse again. Second night running. Spares are in the box on the switchboard, top row.'],
  c1_radar_3: ['engineer', 'Не понимаю. Нагрузки нет, а он горит. Будто кто-то его выкручивает.', 'I don\'t understand it. There\'s no load, and it burns out. As if someone were unscrewing it.'],
  c1_radar_4: ['engineer', 'Свет! Стой где стоишь, по трапу в темноте не ходи.', 'The lights! Stay where you are, don\'t take the ladder in the dark.'],

  // something knocks along the hull
  c1_knock_1: ['engineer', 'Слышишь? Это не лёд. Лёд скребёт, а это стучит.', 'Hear that? That\'s not ice. Ice scrapes. This knocks.'],
  c1_knock_2: ['engineer', 'Три удара. Пауза. Опять три. Снаружи, ниже ватерлинии.', 'Three knocks. A pause. Three again. Outside, below the waterline.'],
  c1_knock_3: ['deckhand', 'Там же вода. Кто может стучать из воды?', 'There\'s only water out there. Who can knock from the water?'],

  // the mess radio picks up Severny: a woman counting, then your name
  c1_radio_1: ['cook', 'Тише! Приёмник что-то ловит. Это «Северный»?', 'Quiet! The set\'s picking something up. Is that Severny?'],
  c1_radio_2: ['markova', 'Раз. Два. Три. Четыре. Пять. Шесть. Семь.', 'One. Two. Three. Four. Five. Six. Seven.'],
  c1_radio_3: ['markova', 'Восемь. Девять. Десять. Одиннадцать. Двенадцать.', 'Eight. Nine. Ten. Eleven. Twelve.'],
  c1_radio_4: ['deckhand', 'Это женщина. Она просто считает. Зачем она считает?', 'It\'s a woman. She\'s just counting. Why is she counting?'],
  c1_radio_5: ['mimic', 'Андрей. Андрей Никитин. Ты меня слышишь?', 'Andrei. Andrei Nikitin. Can you hear me?'],
  c1_radio_6: ['mimic', 'Мы тебя ждём, Андрей. Нам холодно.', 'We\'re waiting for you, Andrei. We\'re cold.'],
  c1_radio_7: ['cook', 'Откуда она знает, как тебя зовут?', 'How does she know your name?'],
  c1_radio_8: ['soldier1', 'Выключите. Выключите приёмник. И никому не отвечать.', 'Switch it off. Switch that set off. And nobody answers it.'],

  // a polar bear torn open on a floe
  c1_bear_1: ['bosun', 'Глянь на льдину. Медведь. Разорван от горла до брюха.', 'Look at that floe. A bear. Torn open from throat to belly.'],
  c1_bear_2: ['bosun', 'Кто может так порвать медведя? Тут крупнее медведя никого нет.', 'What could tear a bear like that? There\'s nothing up here bigger than a bear.'],
  c1_bear_3: ['deckhand', 'Он его даже не ел. Порвал и бросил.', 'It didn\'t even eat it. Tore it open and left it.'],

  // a figure on the ice in the searchlight, not there (twice)
  c1_figure_1: ['soldier3', 'Человек на льду! Справа по носу, в луче!', 'Man on the ice! Starboard bow, in the beam!'],
  c1_figure_2: ['captain', 'Где? Нет там никого. Левее... правее... Пусто.', 'Where? There\'s nobody there. Left a bit... right... Empty.'],
  c1_figure_3: ['soldier3', 'Он стоял. Стоял и смотрел на нас. Без шапки.', 'He was standing there. Standing and looking at us. No hat.'],
  c1_figure_4: ['soldier3', 'Опять! Вон он... Нет. Опять нет.', 'Again! There he is... No. Gone again.'],

  // a dark, dead station
  c1_approach_1: ['captain', 'Вот и «Северный». Ни одного огня. Ни на мачте, ни в окнах.', 'There\'s Severny. Not a single light. Not on the mast, not in the windows.'],
  c1_approach_2: ['captain', 'Подводи к причалу, малым ходом. Боцман, приготовить концы.', 'Bring her in to the berth, slow ahead. Bosun, get the lines ready.'],
  c1_approach_3: ['bosun', 'Причал весь во льду. Его неделю никто не чистил.', 'The berth\'s all iced over. Nobody\'s cleared it for a week.'],

  // alongside
  c1_moored_1: ['captain', 'Стоим. Орлов, ваши готовы? Второй и боцман идут с вами.', 'We\'re alongside. Orlov, are your men ready? The second mate and the bosun go with you.'],
  c1_moored_2: ['soldier1', 'Готовы. Белов — со мной. Ахметов, Смирнов — у трапа. На борт никого не пускать. Никого.', 'Ready. Belov, with me. Akhmetov, Smirnov: at the gangway. Let nobody aboard. Nobody.'],
  c1_moored_3: ['captain', 'Второй. Будь осторожен. Связь по рации каждые полчаса.', 'Second. Be careful. Radio check every half hour.'],

  // =========================================================================================
  // 2. СЕВЕРНЫЙ: the station in a blizzard
  // =========================================================================================

  // ashore, with the bosun and Orlov
  c2_ashore_1: ['bosun', 'Тихо-то как. Даже собаки не лают. На «Северном» собаки всегда лают.', 'It\'s so quiet. Not even the dogs. The dogs at Severny always bark.'],
  c2_ashore_2: ['bosun', 'Следы. Босые. В минус тридцать восемь — босиком.', 'Footprints. Bare feet. At thirty-eight below, barefoot.'],
  c2_ashore_3: ['soldier1', 'Делимся. Мы с Беловым — на купол, к буровой. Вы — дизельная и главный дом. Связь каждые десять минут.', 'We split up. Belov and I go up the cap to the drilling shed. You take the generator and the main house. Radio check every ten minutes.'],
  c2_ashore_4: ['bosun', 'Дверь заколочена. Изнутри: гвозди в нашу сторону торчат.', 'The door\'s nailed shut. From the inside: the nails are sticking out our way.'],
  c2_ashore_5: ['bosun', 'Без света тут как в погребе. Дизелю нужна солярка и предохранитель. Солярка на складе ГСМ, предохранители — в мастерской, если Карпенко их не съел.', 'Without light it\'s a cellar in here. The generator needs diesel and a fuse. Diesel\'s at the fuel depot, fuses are in the workshop, unless Karpenko ate them.'],
  c2_ashore_6: ['bosun', 'Я на судно, доложу капитану. А ты держись Орлова. Слышишь? Держись Орлова.', 'I\'m going back aboard to report to the captain. You stick with Orlov. Hear me? Stick with Orlov.'],

  // Orlov on the walkie-talkie, from the ice cap (his last calls)
  c2_orlov_1: ['soldier1', 'Второй, я Орлов. Мы у буровой. Дверь открыта, внутри никого. Во льду шурф, метра полтора. Скобы вниз.', 'Second, this is Orlov. We\'re at the drilling shed. Door\'s open, nobody inside. There\'s a shaft in the ice, a metre and a half across. Rungs going down.'],
  c2_orlov_2: ['soldier1', 'Второй, вижу свет! Станция светится. Молодец.', 'Second, I see light! The station\'s lit up. Well done.'],
  c2_orlov_3: ['soldier1', 'Второй. Белов пропал. Был в двух шагах. Я обернулся — нет.', 'Second. Belov\'s gone. He was two paces from me. I turned round, and he wasn\'t there.'],
  c2_orlov_4: ['soldier1', 'Он меня зовёт. Из шахты. Белов зовёт меня из шахты.', 'He\'s calling me. From the shaft. Belov\'s calling me from the shaft.'],
  c2_orlov_5: ['soldier1', 'Они не мёртвые. Холодные, но не мёртвые. Их много. Они идут вниз, к станции.', 'They\'re not dead. Cold, but not dead. There are lots of them. They\'re coming down to the station.'],
  c2_orlov_6: ['soldier1', 'Второй... передай на судно: «Тишина». Слышишь? Код «Тишина». Пусть уходят.', 'Second... tell the ship: "Silence". You hear me? Code "Silence". Tell them to go.'],

  // after he is gone: Orlov's voice again (the Guest)
  c2_false_1: ['soldier1', 'Всё спокойно. Продолжайте.', 'All quiet. Carry on.'],
  c2_false_2: ['soldier1', 'Второй, я Орлов. Всё спокойно. Идите к буровой, я вас жду.', 'Second, this is Orlov. All quiet. Come up to the drilling shed, I\'m waiting for you.'],

  // =========================================================================================
  // 3. ГОЛОСА: the radio room, the lab, the station searched
  // =========================================================================================

  // the feeder mended, the Polyarnik called: the captain answers (it is him)
  c3_captain_1: ['captain', '«Северный», я «Полярник». Второй? Второй, это ты? Слава богу.', 'Severny, this is Polyarnik. Second? Second, is that you? Thank God.'],
  c3_captain_2: ['captain', 'Тебя не слышно, одни помехи. Если слышишь меня — слушай.', 'I can\'t hear you, only static. If you can hear me, listen.'],
  c3_captain_3: ['captain', 'Боцман вернулся. Говорит, Орлов ушёл на купол. На льду у борта стоят люди, человек десять. Стоят и смотрят на судно.', 'The bosun\'s back. He says Orlov went up the cap. There are people standing on the ice by the ship, ten or so. Standing and watching the ship.'],
  c3_captain_4: ['captain', 'Ахметов говорит, у них пара изо рта нет. Возвращайся, Андрей. Как сможешь — возвращайся.', 'Akhmetov says there\'s no steam from their mouths. Come back, Andrei. As soon as you can, come back.'],

  // later: the captain answers again, differently (it is not him)
  c3_other_1: ['captain', '«Северный», я «Полярник». Второй, это капитан.', 'Severny, this is Polyarnik. Second, it\'s the captain.'],
  c3_other_2: ['captain', 'Не возвращайся пока. У нас всё спокойно. Люди ушли со льда.', 'Don\'t come back yet. All\'s quiet here. The people have gone from the ice.'],
  c3_other_3: ['captain', 'Сходи в лабораторию. Возьми керн, весь керн, и принеси его на судно.', 'Go to the lab. Take the core, all of the core, and bring it aboard.'],
  c3_other_4: ['captain', 'Мы тебя ждём, Андрей. Мы все тебя ждём. Нам холодно.', 'We\'re waiting for you, Andrei. All of us are waiting. We\'re cold.'],

  // Markova's own tape, in the radio room's recorder (the real her; prop tape_markova)
  c3_markova_1: ['markova', 'Проверка связи. Раз, два, три, четыре, пять. Как слышите? Приём.', 'Radio check. One, two, three, four, five. How do you read me? Over.'],
  c3_markova_2: ['markova', 'Говорит «Северный», Маркова. Если кто-то слышит — не приходите. Слышите? Не приходите сюда.', 'This is Severny, Markova speaking. If anyone can hear me, don\'t come. Do you hear? Don\'t come here.'],
  c3_markova_3: ['markova', 'Я считаю, чтобы не сойти с ума. Сорок пять. Сорок шесть. Сорок семь.', 'I count so I don\'t lose my mind. Forty-five. Forty-six. Forty-seven.'],
  c3_markova_4: ['markova', 'За дверью кто-то считает вместе со мной. Моим голосом. На полсекунды позже.', 'Someone outside the door is counting with me. In my voice. Half a second behind.'],

  // the Turned search the station: voices behind doors
  c3_voices_1: ['mimic', 'Андрей, открой. Это я, Лена. Мне холодно. Пусти погреться.', 'Andrei, open up. It\'s me, Lena. I\'m cold. Let me in to get warm.'],
  c3_voices_2: ['mimic', 'Сорок семь. Сорок семь. Сорок семь.', 'Forty-seven. Forty-seven. Forty-seven.'],
  c3_voices_3: ['deckhand', 'Андрей! Это Лёша! Я на станции, открой! Тут кто-то ходит!', 'Andrei! It\'s Lyosha! I\'m at the station, open up! There\'s someone walking about!'],
  c3_voices_4: ['cook', 'Чай будет скоро. Поставь чайник, раз уж пришёл.', 'Tea soon. Put the kettle on, since you\'re here.'],
  c3_voices_5: ['mimic', 'Где ты? Я тебя слышу. Ты тёплый.', 'Where are you? I can hear you. You\'re warm.'],

  // Gromov's cassette from Shaft 3, in the lab (prop tape_shaft3; transcript ch3_tape_shaft3)
  c3_tape_1: ['chief_tape', 'Шестое декабря, одиннадцать двадцать. Мы в шахте номер три. Со мной Лебедев и Зайцев.', 'The sixth of December, eleven twenty. We\'re in Shaft Three. Lebedev and Zaitsev are with me.'],
  c3_tape_2: ['chief_tape', 'Скобы держат. Стены бетонные, в инее. Тут надпись трафаретом: «Объект-7. Вход воспрещён».', 'The rungs hold. Concrete walls, frosted over. There\'s a stencil here: "Object 7. No entry."'],
  c3_tape_3: ['chief_tape', 'Внизу коридор. Лампы целые. Красная звезда над дверью. Как будто они вышли вчера.', 'A corridor at the bottom. The lamps are intact. A red star over the door. As if they left yesterday.'],
  c3_tape_4: ['chief_tape', 'Столовая. Тарелки на столах, ложки в тарелках. Они ушли, не доев.', 'A canteen. Plates on the tables, spoons in the plates. They left without finishing.'],
  c3_tape_5: ['chief_tape', 'Камеры. Стеклянные. Витя, свет сюда... В них люди. Во льду. У них открыты глаза.', 'Chambers. Glass ones. Vitya, light over here... There are people in them. In the ice. Their eyes are open.'],
  c3_tape_6: ['chief_tape', 'Это лёд. Это преломление, Витя, это свет так падает. Идём дальше.', 'It\'s the ice. It\'s refraction, Vitya, it\'s the way the light falls. Let\'s go on.'],
  c3_tape_7: ['chief_tape', 'Ниже — пещера. Лёд тёмный, как зрачок. Я снял перчатку... Он тёплый. Лёд тёплый.', 'Below there\'s a cave. The ice is dark, like a pupil. I\'ve taken my glove off... It\'s warm. The ice is warm.'],
  c3_tape_8: ['chief_tape', 'Олег? Олег, ты где? Олег!', 'Oleg? Oleg, where are you? Oleg!'],
  c3_tape_9: ['gromov', 'Олег? Олег, ты где? Олег!', 'Oleg? Oleg, where are you? Oleg!'],
  c3_tape_10: ['chief_tape', 'Кто это сказал? Витя... кто это сказал моим голосом?', 'Who said that? Vitya... who said that in my voice?'],

  // =========================================================================================
  // 4. ОБЪЕКТ-7: under the ice cap
  // =========================================================================================

  // Sokolov's address on the reel-to-reel in his office (prop tape_sokolov)
  c4_reel_1: ['sokolov', 'Говорит начальник Объекта-7 полковник Соколов. Сегодня четырнадцатое марта тысяча девятьсот шестьдесят третьего года.', 'This is the commandant of Object 7, Colonel Sokolov. Today is the fourteenth of March, nineteen sixty-three.'],
  c4_reel_2: ['sokolov', 'Приказ Москвы об уничтожении объекта «Гость» не выполнен. Сапёрное отделение из сектора «Г» не вернулось.', 'Moscow\'s order to destroy the object called the Guest has not been carried out. The sapper section has not come back from Sector G.'],
  c4_reel_3: ['sokolov', 'Я принял решение законсервировать объект. Гарнизон остаётся на местах. Выход на поверхность запрещаю.', 'I have decided to seal the facility. The garrison remains at its posts. I forbid anyone to go up to the surface.'],
  c4_reel_4: ['sokolov', 'Пока мы здесь, ворота закрыты. Пока ворота закрыты, оно не выйдет.', 'While we are here, the doors stay shut. While the doors stay shut, it will not get out.'],
  c4_reel_5: ['sokolov', 'Тому, кто найдёт эту запись. Не открывайте ворота. Не верьте голосам. Нашим голосам — тоже.', 'To whoever finds this recording. Do not open the doors. Do not trust the voices. Ours included.'],
  c4_reel_6: ['sokolov', 'Если вы всё-таки пришли, значит, ваше время хуже нашего. Подрывная машинка — в моём сейфе.', 'If you have come all the same, then your times are worse than ours. The blasting machine is in my safe.'],
  c4_reel_7: ['sokolov', 'Свод пещеры стоит на трёх ледяных колоннах. Обрушьте свод. Мы не смогли. Сможете вы.', 'The cave\'s roof stands on three ice pillars. Bring the roof down. We could not. You will.'],
  c4_reel_8: ['sokolov', 'Служу Советскому Союзу.', 'I serve the Soviet Union.'],

  // the voices in the facility's dark
  c4_voices_1: ['mimic', 'Здесь тепло. Иди сюда. Здесь тепло.', 'It\'s warm here. Come here. It\'s warm here.'],
  c4_voices_2: ['soldier1', 'Второй, я Орлов. Я внизу. Иди на голос.', 'Second, this is Orlov. I\'m down here. Follow my voice.'],
  c4_voices_3: ['sokolov', 'Часовой, откройте. Это полковник Соколов. Откройте ворота.', 'Sentry, open up. This is Colonel Sokolov. Open the doors.'],
  c4_voices_4: ['captain', 'Андрей, хватит. Поднимайся. Мы все на борту, ждём только тебя.', 'Andrei, that\'s enough. Come up. We\'re all aboard, we\'re only waiting for you.'],

  // Gromov, what he has become
  c4_gromov_1: ['gromov', 'Холодно... Холодно...', 'Cold... So cold...'],
  c4_gromov_2: ['gromov', 'Надя? Надя... я дома.', 'Nadya? Nadya... I\'m home.'],
  c4_gromov_3: ['gromov', 'Не жги... не жги нас.', 'Don\'t burn... don\'t burn us.'],
  c4_gromov_4: ['gromov', 'Мы... все... здесь. Все внизу.', 'We\'re... all... here. All down here.'],
  c4_gromov_5: ['gromov', 'Андрей. Останься. Здесь тепло.', 'Andrei. Stay. It\'s warm here.'],
  c4_gromov_6: ['gromov', 'Сожги... Сожги меня.', 'Burn... Burn me.'],

  // the thermite on the three pillars, and the run
  c4_charges_1: ['mimic', 'Не надо. Не надо. Нам будет холодно.', 'Don\'t. Don\'t. We\'ll be cold.'],
  c4_charges_2: ['mimic', 'Андрей! Андрей, вернись!', 'Andrei! Andrei, come back!'],

  // =========================================================================================
  // 5. ДОМОЙ: the tug, dark at her lines
  // =========================================================================================

  // her crew, taken, in their own words
  c5_aboard_1: ['deckhand', 'Андрей, ты вернулся! Иди к нам, мы в кают-компании. Все тут.', 'Andrei, you\'re back! Come to us, we\'re in the mess. Everyone\'s here.'],
  c5_aboard_2: ['cook', 'На обед борщ. На ужин тоже борщ.', 'Borscht for lunch. Borscht for dinner, too.'],
  c5_aboard_3: ['engineer', 'Двигатель работает как часы. Слышишь?', 'The engine runs like a clock. Hear it?'],
  c5_aboard_4: ['bosun', 'Не стой на линии троса! Лопнет — пополам разрежет.', 'Don\'t stand in the line of the hawser! If it snaps, it\'ll cut you in half.'],
  // what is standing at the wheel
  c5_aboard_5: ['captain', 'Курс на «Северный»: норд-норд-ост, два с половиной километра. Крупные льдины обходи, мелочь дави.', 'Course for Severny: north-north-east, two and a half kilometres. Go round the big floes, push the small stuff aside.'],
  c5_aboard_6: ['captain', 'Куда ты, штурман? Мы ещё не пришли. «Северный» ждёт нас.', 'Where are you going, navigator? We\'re not there yet. Severny is waiting for us.'],

  // open water
  c5_open_1: ['radio', '«Полярник», я Диксон-радио. «Полярник», ответьте. Вас не слышу.', 'Polyarnik, this is Dikson Radio. Polyarnik, come in. I can\'t hear you.'],
  c5_open_2: ['mimic', '«Полярник», я «Северный»… Мы ждём вас.', 'Polyarnik, this is Severny... We\'re waiting for you.'],
};

// the lines the Guest says in a voice it has taken (play them wrong)
export const MIMICKED = [
  'c1_radio_5', 'c1_radio_6',
  'c2_false_1', 'c2_false_2',
  'c3_other_1', 'c3_other_2', 'c3_other_3', 'c3_other_4',
  'c3_voices_1', 'c3_voices_2', 'c3_voices_3', 'c3_voices_4', 'c3_voices_5',
  'c3_tape_9',
  'c4_voices_1', 'c4_voices_2', 'c4_voices_3', 'c4_voices_4',
  'c4_charges_1', 'c4_charges_2',
  'c5_aboard_1', 'c5_aboard_2', 'c5_aboard_3', 'c5_aboard_4', 'c5_aboard_5', 'c5_aboard_6',
  'c5_open_2',
];

// each beat's lines in order: BEATS.c1_brief = ['c1_brief_1', ..., 'c1_brief_6']
export const BEATS = {};
for (const id of Object.keys(SCRIPT)) (BEATS[id.replace(/_\d+$/, '')] ||= []).push(id);
