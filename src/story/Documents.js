// The readable documents of АРКТИЧЕСКИЙ (CONTRACTS.md, "Documents"): every note, journal, telex,
// report, tape transcript, photograph and wall sign the player can pick up or read, in Russian with
// an English translation, grouped by chapter.
//
//   DOCUMENTS[id] = { chapter, kind, date, place, title: { ru, en }, body: { ru, en }, author }
//   kind: 'journal' | 'note' | 'telex' | 'report' | 'tape' | 'poster' | 'photo'
//   place: where it lies in the world (for the levels); date: as written on it (Soviet order, d.m.y)
//
// The story's year is 1990: the Polyarnik reaches Severny on 21 December, nine days after the
// station's last transmission (12 December). The player is the second mate, Andrei Nikitin.
//
// The clues the player needs:
//   the lab door code 0612 (day and month of the descent)  ch2_gromov_4; the date in ch3_tape_shaft3,
//                                                          ch2_duty_log, ch4_drill_log
//   Gromov's lab pass: behind Nadya's photograph            ch2_gromov_4, ch2_photo_nadya
//   fuel at the depot, the fuse on the workshop bench       ch2_generator_card, ch2_key_board
//   spare keys (depot, generator, kennel) on the workshop key board; the radio room's spare key in
//   the duty desk drawer                                    ch2_key_board, ch2_duty_log
//   Sokolov's safe 1204 (day and month of Gagarin's flight) ch4_belyaeva_2 + ch4_poster_gagarin
//   the detonator (КПМ-1) in the safe                      ch4_archive_card, ch4_order_63
//   the breakers: II (pumps), then I (bus), then III (doors) ch4_zubov_note, ch4_sign_reactor
//   the three ice pillars under the cave's roof             ch4_guest_report, ch4_gromov_last
//   the tug's engine: air bottles, fuel cock, start button  ch5_engine_scrawl, ch5_captain_last

// a block of text, written indented here: the first and last line breaks and the common indent go
const txt = ([s]) => {
  const lines = s.replace(/^\n|\n[ \t]*$/g, '').split('\n');
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(pad)).join('\n');
};

export const DOCUMENTS = {
  // =========================================================================================
  // 1. МОЛЧАНИЕ: aboard the Polyarnik
  // =========================================================================================

  ch1_telex: {
    chapter: 1, kind: 'telex', date: '15.12.1990',
    place: 'Polyarnik: the bridge, the telex printout on the chart table',
    author: 'Murmansk Shipping Company, Dikson dispatch office',
    title: { ru: 'Телекс из Диксона', en: 'Telex from Dikson' },
    body: {
      ru: txt`
        ТЛГ 1187 ДИКСОН 15/12 1990 1420 МСК
        ДСП
        БУКСИР-ЛЕДОКОЛ ПОЛЯРНИК КМ ВОЛКОВУ В.С.

        ПО УКАЗАНИЮ МИНИСТЕРСТВА ЗПТ СОГЛАСОВАНО С ГОСКОМГИДРОМЕТОМ ТЧК ПОЛЯРНАЯ СТАНЦИЯ СЕВЕРНЫЙ НЕ ВЫХОДИТ НА СВЯЗЬ С 0800 12/12 ТЧК ПОСЛЕДНЯЯ ПЕРЕДАЧА ЦИТИРУЮ СВОДКА БУДЕТ ПОЗЖЕ КОНЕЦ ЦИТАТЫ ТЧК

        ПРЕДПИСЫВАЮ
        1 ПРИНЯТЬ НА БОРТ ОТДЕЛЕНИЕ ВЧ 2198 СЕРЖ ОРЛОВ 4 ЧЕЛ ЗПТ ГРУЗ ОТДЕЛЕНИЯ НЕ ДОСМАТРИВАТЬ ТЧК
        2 ДОСТАВИТЬ НА СЕВЕРНЫЙ ЗИМНИЙ ЗАВОЗ ПО ВЕДОМОСТИ И ПОЧТУ ТЧК
        3 ВЫСАДКА ЭКИПАЖА НА ОСТРОВ ТОЛЬКО С СОГЛАСИЯ СЕРЖ ОРЛОВА ТЧК РАСПОРЯЖЕНИЯ СЕРЖ ОРЛОВА НА БЕРЕГУ ВЫПОЛНЯТЬ БЕЗ ОБСУЖДЕНИЯ ТЧК
        4 НА КУПОЛ ОСТРОВА НЕ ПОДНИМАТЬСЯ ТЧК
        5 О ПРИБЫТИИ И ОБСТАНОВКЕ ДОКЛАДЫВАТЬ ЕЖЕСУТОЧНО ТЧК
        ВЫХОД НЕ ПОЗДНЕЕ 0600 16/12 ТЧК

        НАЧ ДИСПЕТЧЕРСКОЙ СЛУЖБЫ ММП СЕРГЕЕВ
      `,
      en: txt`
        TLG 1187 DIKSON 15/12 1990 1420 MSK
        FOR OFFICIAL USE ONLY
        ICEBREAKING TUG POLYARNIK MASTER VOLKOV V.S.

        ON MINISTRY INSTRUCTIONS COMMA AGREED WITH STATE HYDROMET COMMITTEE STOP POLAR STATION SEVERNY HAS NOT CALLED SINCE 0800 12/12 STOP LAST TRANSMISSION QUOTE WEATHER REPORT WILL FOLLOW UNQUOTE STOP

        YOU ARE ORDERED
        1 TAKE ABOARD SECTION OF MILITARY UNIT 2198 SGT ORLOV 4 MEN COMMA SECTION CARGO NOT TO BE INSPECTED STOP
        2 DELIVER TO SEVERNY WINTER SUPPLIES PER MANIFEST AND MAIL STOP
        3 CREW TO GO ASHORE ONLY WITH SGT ORLOVS CONSENT STOP ASHORE SGT ORLOVS INSTRUCTIONS TO BE CARRIED OUT WITHOUT DISCUSSION STOP
        4 DO NOT GO UP ONTO THE ISLANDS ICE CAP STOP
        5 REPORT ARRIVAL AND SITUATION DAILY STOP
        SAIL NO LATER THAN 0600 16/12 STOP

        HEAD OF DISPATCH MURMANSK SHIPPING CO SERGEEV
      `,
    },
  },

  ch1_roster: {
    chapter: 1, kind: 'report', date: '01.09.1990',
    place: 'Polyarnik: the bridge, in the station\'s mail folder',
    author: 'USSR State Committee for Hydrometeorology, Northern Directorate',
    title: { ru: 'Список зимовщиков ПС «Северный»', en: 'Severny Station: the wintering party' },
    body: {
      ru: txt`
        ГОСКОМГИДРОМЕТ СССР. Северное управление.
        Полярная станция «Северный». Личный состав на зимовку 1990/91 г.

        1. Громов Анатолий Петрович — начальник станции, гляциолог
        2. Лебедев Виктор Николаевич — буровой мастер
        3. Зайцев Олег Игоревич — буровик
        4. Шульга Ирина Васильевна — инженер-гидрохимик
        5. Маркова Елена Сергеевна — радиооператор
        6. Голубев Сергей Андреевич — метеоролог
        7. Галиев Рустам Фаридович — аэролог
        8. Карпенко Игорь Тарасович — механик-дизелист
        9. Ершов Павел Григорьевич — врач
        10. Кольцова Тамара Ивановна — повар
        11. Вануйто Ефим Николаевич — каюр, рабочий

        Всего: 11 человек. Ездовых собак: 14.

        [Карандашом, на полях:]
        Громов — шестнадцатая зимовка. Маркова — первая. — В.
      `,
      en: txt`
        USSR STATE COMMITTEE FOR HYDROMETEOROLOGY. Northern Directorate.
        Polar Station Severny. Wintering party, 1990/91.

        1. Gromov, Anatoly Petrovich: station chief, glaciologist
        2. Lebedev, Viktor Nikolaevich: drilling master
        3. Zaitsev, Oleg Igorevich: driller
        4. Shulga, Irina Vasilyevna: hydrochemical engineer
        5. Markova, Elena Sergeevna: radio operator
        6. Golubev, Sergei Andreevich: meteorologist
        7. Galiev, Rustam Faridovich: upper-air observer
        8. Karpenko, Igor Tarasovich: diesel mechanic
        9. Ershov, Pavel Grigoryevich: doctor
        10. Koltsova, Tamara Ivanovna: cook
        11. Vanuyto, Yefim Nikolaevich: dog handler, labourer

        Total: 11 persons. Sled dogs: 14.

        [In pencil, in the margin:]
        Gromov: his sixteenth winter. Markova: her first. — V.
      `,
    },
  },

  ch1_captain_log: {
    chapter: 1, kind: 'journal', date: '16–19.12.1990',
    place: 'Polyarnik: the captain\'s cabin, on the desk',
    author: 'Captain V. S. Volkov',
    title: { ru: 'Дневник капитана Волкова', en: 'Captain Volkov\'s diary' },
    body: {
      ru: txt`
        16 декабря.
        Вышли из Диксона в 05:50. В трюме — зимний завоз для «Северного»: мука, крупы, консервы, сорок бочек солярки, запчасти к дизелю, почта за полгода.
        Перед самым отходом привезли пограничников: сержант Орлов и трое рядовых, мальчишки. С ними шесть зелёных ящиков, опломбированных. В трюм не дали — затащили к себе в кубрик и спят на них. Орлов вежлив и на вопросы не отвечает. Тридцать лет хожу по Северу, такого попутного груза не возил.

        17 декабря.
        Лёд восемь баллов, торосы. Идём малым. Диксон-радио: «Северный» молчит пятые сутки. Громова я знаю двадцать лет. Двадцать лет он выходил на связь минута в минуту, даже когда у него горела дизельная. Он бы не молчал.
        Лёша за ужином спрашивал меня про «Объект». Наслушался боцмана. Я велел не повторять кубриковые байки. Орлов в это время встал и вышел. Не доел.

        18 декабря.
        Ночью Ахметов поднял вахту: на льдине человек. Я смотрел в бинокль — пусто. Ахметов клянётся, что человек стоял без шапки и смотрел на судно. Вахтенным разговоры об этом запретил.
        Кузнецов жалуется: выбивает предохранитель навигационных приборов, а причины он не найдёт. Свет мигает.
        Записываю для порядка: за двое суток ни одной чайки. Ни одного моржа. Лёд пустой.

        19 декабря.
        Осталось меньше двух суток хода. Второму помощнику велел готовиться к высадке с Орловым: он изучал схему станции. Пусть привыкает, что на берегу командует не он и не я.
        Сегодня впервые подумал, что не хочу туда идти. Пишу это и сам себе удивляюсь.
      `,
      en: txt`
        16 December.
        Left Dikson at 05:50. In the hold: Severny's winter supplies. Flour, grain, tinned food, forty drums of diesel, spares for the generator, six months of mail.
        Just before we sailed they brought the border guards: Sergeant Orlov and three privates, boys. With them, six green crates, sealed. They wouldn't let them go in the hold: they hauled them into their quarters and sleep on them. Orlov is polite and answers no questions. Thirty years in the North, and I've never carried cargo like this.

        17 December.
        Ice eight-tenths, ridged. Slow ahead. Dikson Radio: Severny silent for the fifth day. I've known Gromov twenty years. For twenty years he came on the air to the minute, even the time his generator shed was on fire. He wouldn't go quiet.
        At supper Lyosha asked me about "the Object". He's been listening to the bosun. I told him not to repeat fo'c'sle tales. Orlov got up and left while we talked. He didn't finish his food.

        18 December.
        In the night Akhmetov turned out the watch: a man on a floe. I looked through the binoculars: nothing. Akhmetov swears the man stood bareheaded, watching the ship. I've forbidden the watch to talk about it.
        Kuznetsov complains the fuse for the navigation instruments keeps blowing, and he can't find why. The lights flicker.
        For the record: not one gull in two days. Not one walrus. The ice is empty.

        19 December.
        Less than two days' steaming left. I've told the second mate to be ready to go ashore with Orlov: he has studied the station's plan. Let him get used to the idea that ashore it isn't him in command, or me.
        Today, for the first time, I thought that I don't want to go there. I write it down and I surprise myself.
      `,
    },
  },

  ch1_orlov_orders: {
    chapter: 1, kind: 'report', date: '14.12.1990',
    place: 'Polyarnik: the soldiers\' quarters, the opened envelope on Orlov\'s bunk',
    author: 'Colonel Yartsev, head of the special department',
    title: { ru: 'Предписание сержанту Орлову', en: 'Sergeant Orlov\'s sealed orders' },
    body: {
      ru: txt`
        СОВЕРШЕННО СЕКРЕТНО. Экземпляр единственный.
        Вскрыть по прибытии в район о. Северный.

        Командиру отделения в/ч 2198 сержанту Орлову Д. А.

        ПРЕДПИСАНИЕ
        1. По прибытии на ПС «Северный» установить местонахождение и состояние личного состава станции (11 чел.).
        2. Не допускать доступа кого-либо, включая экипаж судна и личный состав станции, к ОБЪЕКТУ-7 и его сооружениям, в том числе к вентиляционной шахте № 3 (буровая площадка на куполе).
        3. Ледяной керн, поднятый станцией после 28.11.90, и любые образцы из шахты № 3 уничтожить на месте сжиганием. Средства: шашки термитные ТШ — 3 шт., машинка подрывная КПМ-1. Образцы не вскрывать, голыми руками не касаться, на судно не принимать.
        4. Лиц, спускавшихся в шахту № 3, а также лиц с признаками глубокого переохлаждения при сохранённой подвижности (нет пара при дыхании на морозе, не реагируют на холод) — изолировать. При неповиновении применять оружие. Предпочтительно огонь.
        5. Голосовым сообщениям со станции и с объекта, в том числе голосам знакомых вам лиц, не доверять.
        6. Экипаж судна в содержание предписания не посвящать.
        7. Доклад — кодовым словом через судовую радиостанцию:
           «ПОЗЁМКА» — задача выполнена;
           «ПУРГА» — нужна помощь;
           «ТИШИНА» — судну уходить без отделения, на остров никого не высаживать.

        Начальник особого отдела
        полковник Ярцев
        14.12.1990
      `,
      en: txt`
        TOP SECRET. Single copy.
        To be opened on arrival off Severny Island.

        To the commander of a section of military unit 2198, Sergeant D. A. Orlov.

        ORDERS
        1. On arrival at Polar Station Severny, establish the whereabouts and condition of the station's personnel (11 persons).
        2. Allow no one, including the ship's crew and the station's personnel, access to OBJECT 7 and its structures, including ventilation shaft No. 3 (the drilling site on the ice cap).
        3. The ice core raised by the station after 28.11.90, and any samples from shaft No. 3, are to be destroyed on the spot by burning. Means: thermite charges TSh, 3; blasting machine KPM-1. Do not open the samples, do not touch them bare-handed, do not take them aboard the ship.
        4. Persons who have been down shaft No. 3, and persons showing signs of deep hypothermia while still able to move (no breath vapour in the frost, no reaction to cold), are to be isolated. If they resist, use your weapons. Fire is preferred.
        5. Do not trust voice messages from the station or from the Object, including the voices of people known to you.
        6. The ship's crew is not to be told the content of these orders.
        7. Report by code word over the ship's radio:
           "DRIFTING SNOW": task complete;
           "BLIZZARD": help needed;
           "SILENCE": the ship is to leave without the section and put no one ashore.

        Head of the special department
        Colonel Yartsev
        14.12.1990
      `,
    },
  },

  ch1_engine_note: {
    chapter: 1, kind: 'note', date: '19.12.1990',
    place: 'Polyarnik: the engine room, taped to the switchboard',
    author: 'Chief Engineer Kuznetsov',
    title: { ru: 'Записка на щите', en: 'Note on the switchboard' },
    body: {
      ru: txt`
        ВАХТЕННЫМ МОТОРИСТАМ И ВСЕМ, КТО ПОЛЕЗЕТ В ЩИТ.

        1. Предохранитель цепи навигационных приборов (радар, эхолот) выбивает вторую ночь. Нагрузки нет, замыкания нет. Причину не нашёл. Запасные — в железном ящике на щите, верхний ряд. Меняйте, только сначала выключите автомат, а не как Лёша.

        2. В 03:30 стучали по корпусу. Правый борт, шпангоуты 40–42, ниже ватерлинии. Три удара, пауза, опять три. Это не лёд и не наш механизм: я проверил всё, что у нас может стучать. Если начнётся опять — запишите время и позовите меня. Руками к борту не прикладывайтесь.

        Стармех Кузнецов
      `,
      en: txt`
        TO THE MOTORMEN ON WATCH AND ANYONE ELSE WHO GOES INTO THIS BOARD.

        1. The fuse on the navigation instruments circuit (radar, echo sounder) has blown two nights running. No load, no short. I haven't found the cause. Spares are in the steel box on the board, top row. Change it, but switch the breaker off first, not like Lyosha did.

        2. At 03:30 something knocked on the hull. Starboard side, frames 40 to 42, below the waterline. Three knocks, a pause, three again. It isn't ice and it isn't our machinery: I've checked everything we have that could knock. If it starts again, write down the time and call me. Don't put your hands on the hull.

        Chief Engineer Kuznetsov
      `,
    },
  },

  ch1_lyosha_letter: {
    chapter: 1, kind: 'note', date: '18.12.1990',
    place: 'Polyarnik: the crew quarters, under Lyosha\'s pillow',
    author: 'Deckhand Alexei (Lyosha) Pavlov',
    title: { ru: 'Письмо Лёши домой', en: 'Lyosha\'s letter home' },
    body: {
      ru: txt`
        Мама, здравствуй!

        Пишу тебе с «Полярника», отправлю с Диксона, когда вернёмся. У меня всё хорошо, не волнуйся. Кормят как на убой: Семёныч печёт блины и ругается, что солдаты едят отдельно. Солдат у нас четверо, везём их на полярную станцию, а зачем — никто не говорит. Сержант строгий, но дал мне подержать свой автомат. Только ты не пугайся.

        Холод такой, что на вахте у меня иней на ресницах. Северное сияние каждую ночь. Ты бы видела, мама.

        Боцман вечером рассказывал, что под островом, куда мы идём, ещё при Хрущёве военные что-то построили и что туда ушёл целый полк и не вернулся. Боцман, конечно, врёт, он всегда врёт. Но сержант, когда это услышал, встал и вышел.

        И ещё. Ночью я стоял на корме, и меня кто-то позвал со льда. По имени: «Лёша». Твоим голосом, мама. Я знаю, что это ветер. Я просто пишу тебе, чтобы ты

        [Дальше не дописано.]
      `,
      en: txt`
        Hello, Mum!

        I'm writing from the Polyarnik and I'll post it from Dikson when we're back. I'm fine, don't worry. They feed us like we're being fattened up: Semyonych bakes pancakes and grumbles that the soldiers eat on their own. We've got four soldiers aboard, we're taking them to a polar station, and nobody says why. The sergeant is strict, but he let me hold his rifle. Don't be scared.

        It's so cold that on watch I get frost on my eyelashes. Northern lights every night. You should see them, Mum.

        In the evening the bosun was telling us that under the island we're going to, back in Khrushchev's day, the army built something, and a whole regiment went down into it and never came back. The bosun's lying, of course, he always lies. But when the sergeant heard it, he got up and walked out.

        And one more thing. Last night I was standing on the stern and someone called me from the ice. By name: "Lyosha". In your voice, Mum. I know it was the wind. I'm only writing so that you

        [The rest is not written.]
      `,
    },
  },

  // =========================================================================================
  // 2. СЕВЕРНЫЙ: the station
  // =========================================================================================

  ch2_door_main: {
    chapter: 2, kind: 'note', date: '13.12.1990',
    place: 'Severny: the main house, nailed to the front door',
    author: 'S. A. Golubev, meteorologist',
    title: { ru: 'Записка на двери главного дома', en: 'Note on the main house door' },
    body: {
      ru: txt`
        ДВЕРЬ НЕ ОТКРЫВАТЬ.
        Мы внутри. Живые — стучите три раза, потом два.
        Остальные — уходите. Вы знаете, о ком я.
        С. Голубев, 13.12

        [Ниже, карандашом, другой рукой:]
        Три и два. Они уже знают. Они стояли под окном, когда мы договаривались.
      `,
      en: txt`
        DO NOT OPEN THIS DOOR.
        We're inside. The living: knock three times, then twice.
        The rest of you: go away. You know who I mean.
        S. Golubev, 13.12

        [Below, in pencil, in another hand:]
        Three and two. They know it already. They were standing under the window when we agreed on it.
      `,
    },
  },

  ch2_gromov_1: {
    chapter: 2, kind: 'journal', date: '15–28.11.1990',
    place: 'Severny: the main house, Gromov\'s room, on the desk',
    author: 'A. P. Gromov, station chief',
    title: { ru: 'Дневник Громова. Бурение', en: 'Gromov\'s journal: the drilling' },
    body: {
      ru: txt`
        15 ноября 1990.
        Затащили буровую на купол. Шестнадцатая моя зимовка, и впервые у меня свой керн: вся история острова, лёд за тысячи лет, слой за слоем. Лебедев доволен как ребёнок. Зайцев ругает мороз и меня.
        Место для скважины выбрал сам. Радарная съёмка восемьдесят восьмого года показала здесь под фирном странные отражения: прямые линии, прямые углы. Природа так не строит. Лебедеву сказал, что это трещина. Себе — не знаю что.

        20 ноября.
        Начали. Термобур идёт хорошо, по пять метров в сутки. Вечером в кают-компании Вануйто спросил, где бурим. Я показал на карте. Он долго молчал, потом сказал: «Там нельзя. Там спит тот, кто ест тепло». Тамара Ивановна перекрестилась. Посмеялись.

        27 ноября.
        39,6 м. С тридцати семи метров в керне тёмные прожилки, тонкие, как волос. Ирина говорит — вулканическая пыль. Пусть будет пыль.

        28 ноября.
        41,7 м. Упор. Снаряд встал. Подняли — в коронке бетонная крошка и ржавый пруток арматуры.
        Бетон. Под сорока метрами льда, на куполе необитаемого острова — бетон.
        Ниже бетона, судя по звуку, пустота. Опустили на тросе лампу и микрофон. Пустота большая. И в ней что-то капает.
      `,
      en: txt`
        15 November 1990.
        We've hauled the rig up onto the ice cap. My sixteenth winter, and for the first time I have a core of my own: the island's whole history, thousands of years of ice, layer on layer. Lebedev is as pleased as a child. Zaitsev curses the frost, and me.
        I chose the site for the borehole myself. The radar survey of '88 showed strange reflections here under the firn: straight lines, right angles. Nature doesn't build like that. I told Lebedev it was a crevasse. What I told myself, I don't know.

        20 November.
        We've begun. The thermal drill is going well, five metres a day. In the mess this evening Vanuyto asked where we were drilling. I showed him on the map. He was silent a long time, then said: "Not there. The one who eats warmth sleeps there." Tamara Ivanovna crossed herself. We laughed.

        27 November.
        39.6 m. From thirty-seven metres down there are dark streaks in the core, as fine as hair. Irina says it's volcanic dust. Let it be dust.

        28 November.
        41.7 m. Refusal. The drill has stopped. We brought it up: in the crown, concrete grit and a rusty piece of rebar.
        Concrete. Under forty metres of ice, on the ice cap of an uninhabited island: concrete.
        Below the concrete, by the sound of it, a void. We lowered a lamp and a microphone on a line. The void is large. And something in it is dripping.
      `,
    },
  },

  ch2_gromov_2: {
    chapter: 2, kind: 'journal', date: '01–05.12.1990',
    place: 'Severny: the main house, Gromov\'s room, on the desk',
    author: 'A. P. Gromov, station chief',
    title: { ru: 'Дневник Громова. Шахта № 3', en: 'Gromov\'s journal: Shaft 3' },
    body: {
      ru: txt`
        1 декабря.
        Расширяем скважину паром до шурфа. Вчера открылась плита: бетонная, с железным люком. На плите трафарет, краска почти съедена: «ШАХТА № 3. ВЕНТ.». Под люком колодец вниз, в темноту, и железные скобы в стене.
        Передал на Диксон служебную: под ледником обнаружено техногенное сооружение, прошу указаний. Лена передала и долго на меня смотрела.

        3 декабря.
        Ответ: «Работы прекратить. Сооружение не вскрывать. Ждать представителя». Какого представителя и когда — не сказано. Зимой сюда до мая никто не придёт.
        Ночью не спал. Тридцать лет я читаю лёд, как книгу. А под этой книгой кто-то закопал другую, и мне велят её не открывать.

        5 декабря.
        Вануйто пришёл ко мне сам, в первый раз за три зимовки. Сказал, что его отец возил сюда военных на собаках, «когда Гагарин летал», и что военные ушли под лёд и не вернулись. И что собаки третью ночь воют в сторону купола.
        Я сказал ему, что мы спустимся и поднимемся. Завтра.
      `,
      en: txt`
        1 December.
        We're widening the borehole into a pit with steam. Yesterday the slab appeared: concrete, with an iron hatch. A stencil on the slab, the paint almost eaten away: "SHAFT No. 3. VENT." Under the hatch, a well going down into the dark, and iron rungs in the wall.
        I sent Dikson an official message: a man-made structure found under the glacier, request instructions. Lena sent it and looked at me for a long time.

        3 December.
        The reply: "Stop work. Do not open the structure. Await a representative." What representative, and when, it doesn't say. Nobody will get here before May, not in winter.
        I didn't sleep. For thirty years I've read ice like a book. And under this book someone has buried another, and I'm told not to open it.

        5 December.
        Vanuyto came to see me himself, for the first time in three winters. He said his father brought soldiers here by dog sled "when Gagarin flew", and that the soldiers went down under the ice and never came back. And that the dogs have been howling towards the ice cap for three nights.
        I told him we would go down and come back up. Tomorrow.
      `,
    },
  },

  ch2_gromov_3: {
    chapter: 2, kind: 'journal', date: '06–08.12.1990',
    place: 'Severny: the main house, Gromov\'s room, on the desk',
    author: 'A. P. Gromov, station chief',
    title: { ru: 'Дневник Громова. Спуск', en: 'Gromov\'s journal: the descent' },
    body: {
      ru: txt`
        6 декабря.
        Спустились: я, Лебедев, Зайцев. Взяли магнитофон, всё записано на кассету — пусть потом не говорят, что я выдумал.
        Внизу — целый город. Коридоры, лампы, плакаты, красные звёзды. Столовая с тарелками на столах. Стеклянные камеры, и в них во льду — люди. Десятки. С открытыми глазами. Это был не склад и не убежище. Это была лаборатория, и опыты в ней ставили на людях.
        Ниже — пещера. Лёд там тёмный и тёплый на ощупь. Тёплый лёд: я трогал его голой рукой.
        Олег пропал на сорок минут. Нашли его в боковом проходе: стоял лицом к стене и слушал. Сказал, что его звали.
        Ручным буром взяли шесть кернов из тёмного льда. Ирина унесла их в лабораторию, в морозильную камеру.

        7 декабря.
        Олег молчит. Сидит в кают-компании и смотрит на печку. Ершов говорит — шок.
        Вечером вышел покурить и увидел Олега на крыльце: в одном свитере, в минус тридцать пять. Изо рта у него не шёл пар. У меня шёл, а у него нет.

        8 декабря.
        Ирина принесла протокол. Я прочитал его два раза. В тёмном льду — ткань. Живая. При минус сорока.
        Мы подняли это наверх. Я поднял.
      `,
      en: txt`
        6 December.
        We went down: me, Lebedev, Zaitsev. We took the tape recorder, it's all on cassette, so nobody can say afterwards that I made it up.
        Down there is a whole town. Corridors, lamps, posters, red stars. A canteen with plates on the tables. Glass chambers, and in them, in the ice, people. Dozens. With their eyes open. It wasn't a store or a shelter. It was a laboratory, and the experiments in it were done on people.
        Lower still, a cave. The ice there is dark, and warm to the touch. Warm ice: I touched it with my bare hand.
        Oleg went missing for forty minutes. We found him in a side passage, standing with his face to the wall, listening. He said someone had called him.
        With the hand corer we took six cores from the dark ice. Irina carried them off to the lab, to the cold room.

        7 December.
        Oleg doesn't speak. He sits in the mess and looks at the stove. Ershov says it's shock.
        In the evening I went out for a smoke and found Oleg on the porch: in nothing but a sweater, at thirty-five below. No steam came from his mouth. Mine steamed. His didn't.

        8 December.
        Irina brought me her report. I read it twice. In the dark ice there is tissue. Living. At forty below.
        We brought it up. I brought it up.
      `,
    },
  },

  ch2_gromov_4: {
    chapter: 2, kind: 'journal', date: '09–11.12.1990',
    place: 'Severny: the main house, Gromov\'s room, on the desk',
    author: 'A. P. Gromov, station chief',
    title: { ru: 'Дневник Громова. Баррикада', en: 'Gromov\'s journal: the barricade' },
    body: {
      ru: txt`
        9 декабря.
        У Олега нет пульса. Ершов проверял три раза. Олег ходит, отвечает, ест, если ему дать. Но отвечает он нашими словами — моими, Витиными, Ершова. Повторяет то, что слышал, и не всегда к месту.
        Витя Лебедев ночью ходил на купол один. Вернулся утром, весь в инее, весёлый. Сказал: «Там тепло, Толя».

        10 декабря.
        Лебедев не вернулся с купола. Карпенко пошёл за ним с ракетницей. Карпенко не вернулся.
        Собаки сорвались с цепей. Вануйто закрылся с ними в псарне.
        Лена говорит, что на её счёт в эфире кто-то отвечает. Я слышал сам. Голос Вити Лебедева. А его рация лежит у меня на столе.

        11 декабря.
        Заколотили двери главного дома. Тамара Ивановна с нами не пошла, осталась в столовой: сказала, что ребята придут к ужину и их надо накормить. Ребята пришли. Она их кормит.
        Керн заперт в лаборатории, в морозильной камере. Код на двери я сменил. Новый код — день и месяц, когда мы спустились: 0612. Эту дату я теперь и так не забуду.

        Если кто-то это читает — значит, пришло судно. Керн надо сжечь. Весь, до крошки. Мой пропуск в лабораторию — за Надиной фотографией на стене. Сам я не смог: каждый раз, когда я подношу спичку, у меня в голове кто-то плачет.
      `,
      en: txt`
        9 December.
        Oleg has no pulse. Ershov checked three times. Oleg walks, answers, eats if you give him food. But he answers with our words: mine, Vitya's, Ershov's. He repeats what he has heard, and not always at the right moment.
        Vitya Lebedev went up the ice cap alone in the night. He came back in the morning, white with frost and cheerful. He said: "It's warm down there, Tolya."

        10 December.
        Lebedev didn't come back from the cap. Karpenko went after him with a flare pistol. Karpenko didn't come back.
        The dogs broke their chains. Vanuyto has shut himself in the kennel with them.
        Lena says that when she counts on the air, someone answers. I heard it myself. Vitya Lebedev's voice. And his walkie-talkie is lying on my desk.

        11 December.
        We've nailed the main house shut. Tamara Ivanovna didn't come with us, she stayed in the mess hut: she said the boys would come to supper and they'd need feeding. The boys came. She is feeding them.
        The core is locked in the lab, in the cold room. I've changed the code on the door. The new code is the day and month we went down: 0612. I won't forget that date now in any case.

        If someone is reading this, then the ship has come. The core must be burned. All of it, to the last crumb. My pass to the lab is behind Nadya's photograph on the wall. I couldn't do it myself: every time I bring a match near it, someone inside my head starts to cry.
      `,
    },
  },

  ch2_photo_nadya: {
    chapter: 2, kind: 'photo', date: '05.1979',
    place: 'Severny: the main house, Gromov\'s room, on the wall (his lab pass is tucked behind it)',
    author: 'Nadezhda Gromova',
    title: { ru: 'Фотография Нади', en: 'Nadya\'s photograph' },
    body: {
      ru: txt`
        [Чёрно-белая фотография: женщина в светлом пальто на набережной Невы. Смеётся и придерживает шляпу от ветра.]

        [На обороте, чернилами:]
        Толе — чтобы возвращался.
        Надя. Ленинград, май 1979.

        [Ниже, карандашом, позже:]
        Не успел. Прости. 1986.
      `,
      en: txt`
        [A black-and-white photograph: a woman in a pale coat on the Neva embankment. She is laughing and holding her hat against the wind.]

        [On the back, in ink:]
        For Tolya, so that he comes back.
        Nadya. Leningrad, May 1979.

        [Below, in pencil, later:]
        I didn't make it in time. Forgive me. 1986.
      `,
    },
  },

  ch2_duty_log: {
    chapter: 2, kind: 'journal', date: '06–16.12.1990',
    place: 'Severny: the main house, the hall, on the duty desk',
    author: 'S. A. Golubev and others on duty',
    title: { ru: 'Журнал дежурного по станции', en: 'The station duty log' },
    body: {
      ru: txt`
        ЖУРНАЛ ДЕЖУРНОГО ПО СТАНЦИИ. Декабрь 1990.

        06.12, 09:00. Громов, Лебедев, Зайцев ушли на купол, к шахте. T −31°, ветер СВ 8 м/с. Дежурный Голубев.
        06.12, 18:40. Вернулись. Зайцева вели под руки. Громов велел в журнал не записывать. Записываю.
        08.12, 03:00. Срок. T −36°, ветер СВ 14 м/с, позёмка. На метеоплощадке стоит Зайцев без шапки. Увёл в дом. Не дрожит. Руки холодные, как поручень.
        09.12. Собаки воют всю ночь. Вануйто говорит — воют на купол.
        10.12, 21:00. Лебедев не вернулся с буровой. Карпенко пошёл за ним с ракетницей.
        10.12, 23:10. Карпенко не вернулся. Ракеты не видели.
        11.12, 06:00. Срок. Наблюдения не проводились: на метеоплощадке стоят трое. Зайцев, Карпенко и третий — не наш, в старой шинели. Не двигаются. Снег на них не тает.
        11.12, 14:00. По приказу Громова двери главного дома заколочены. Запасной ключ от радиорубки — у меня, в ящике этого стола.
        12.12, 03:00. Срок. T −41°, штиль. Тихо так, что слышно, как в столовой кто-то двигает стулья.
        12.12, 09:30. Громов ушёл. Сказал: «Я к ним. За мной не ходите». Заколотили за ним дверь.
        12.12, 10:15. Лена говорит, что перерезала антенну. Связи нет.
        14.12. Нас трое: я, Лена, Ершов. Галиев ушёл ночью на голос жены. Жена у него в Казани.
        15.12, 03:00. Срок. T −39°. Под окном стучат: три раза, потом два. Наш сигнал.
        16.12. Ершов перенёс кого-то в баню, говорит — жар их держит. Я больше не пишу сроки. Какая разница, сколько градусов.
      `,
      en: txt`
        STATION DUTY LOG. December 1990.

        06.12, 09:00. Gromov, Lebedev, Zaitsev went up the cap to the shaft. T −31°, wind NE 8 m/s. On duty: Golubev.
        06.12, 18:40. Back. Zaitsev had to be held up on both sides. Gromov said not to put it in the log. I'm putting it in.
        08.12, 03:00. Observation. T −36°, wind NE 14 m/s, drifting snow. Zaitsev standing on the weather site without a hat. Took him indoors. He isn't shivering. His hands are as cold as a handrail.
        09.12. The dogs howled all night. Vanuyto says they're howling at the ice cap.
        10.12, 21:00. Lebedev hasn't come back from the drilling shed. Karpenko went after him with a flare pistol.
        10.12, 23:10. Karpenko hasn't come back. No flare seen.
        11.12, 06:00. Observation not made: three people are standing on the weather site. Zaitsev, Karpenko, and a third who isn't one of ours, in an old army greatcoat. Not moving. The snow doesn't melt on them.
        11.12, 14:00. On Gromov's orders the main house doors are nailed shut. The spare key to the radio room is with me, in the drawer of this desk.
        12.12, 03:00. Observation. T −41°, calm. So quiet you can hear someone moving chairs about in the mess hut.
        12.12, 09:30. Gromov has gone. He said: "I'm going to them. Don't follow me." We nailed the door shut behind him.
        12.12, 10:15. Lena says she has cut the antenna. No radio.
        14.12. There are three of us: me, Lena, Ershov. Galiev went out in the night, following his wife's voice. His wife is in Kazan.
        15.12, 03:00. Observation. T −39°. Knocking under the window: three times, then twice. Our signal.
        16.12. Ershov has carried someone to the banya; he says the heat holds them. I've stopped writing the observations. What does it matter how many degrees it is.
      `,
    },
  },

  ch2_generator_card: {
    chapter: 2, kind: 'note', date: '1989',
    place: 'Severny: the generator hut, on the wall by the diesel',
    author: 'I. T. Karpenko, diesel mechanic',
    title: { ru: 'Инструкция по пуску ДЭС', en: 'Generator start-up card' },
    body: {
      ru: txt`
        ИНСТРУКЦИЯ ПО ПУСКУ ДИЗЕЛЬ-ГЕНЕРАТОРА ДГ-50

        1. Проверить уровень топлива в расходном баке. Ниже метки — долить (дизтопливо, канистра 20 л).
        2. Проверить предохранитель цепи возбуждения на щите (ПН-2, 100 А). Перегоревший — заменить.
        3. Открыть кран подачи топлива.
        4. Рычаг декомпрессора — вверх. Ручным насосом прокачать топливо: 15–20 качков.
        5. Нажать «ПУСК», держать не более 10 секунд. Не завёлся — пауза 30 секунд, повторить.
        6. После выхода на обороты включить рубильник «СЕТЬ».

        Ответственный: механик-дизелист Карпенко И. Т.

        [Карандашом:]
        Последний ПН-2 унёс в мастерскую, лежит на верстаке. Солярка в баке кончается — канистры на складе ГСМ. И. К., 10.12
      `,
      en: txt`
        START-UP INSTRUCTIONS, DG-50 DIESEL GENERATOR

        1. Check the fuel level in the day tank. If below the mark, top up (diesel, 20 l jerrycan).
        2. Check the field circuit fuse on the board (PN-2, 100 A). If blown, replace it.
        3. Open the fuel cock.
        4. Decompression lever up. Prime with the hand pump: 15 to 20 strokes.
        5. Press START and hold for no more than 10 seconds. If it doesn't start, wait 30 seconds and try again.
        6. Once it's up to speed, throw the MAINS switch.

        Responsible: diesel mechanic I. T. Karpenko.

        [In pencil:]
        Took the last PN-2 to the workshop, it's on the workbench. The tank's nearly dry: jerrycans at the fuel depot. I. K., 10.12
      `,
    },
  },

  ch2_key_board: {
    chapter: 2, kind: 'note', date: '10.12.1990',
    place: 'Severny: the main house, the workshop, the key board by the door',
    author: 'I. T. Karpenko, diesel mechanic',
    title: { ru: 'Щит с ключами', en: 'The key board' },
    body: {
      ru: txt`
        КЛЮЧИ БРАТЬ ПОД РОСПИСЬ!

        ДЭС (запасной) .......... на месте
        Склад ГСМ ............... на месте
        Псарня (запасной) ....... на месте
        Радиорубка .............. у Марковой
        Лаборатория ............. у Громова (код у него же)
        Буровая ................. не запирается

        [Записка, приколотая к щиту:]
        Предохранители ПН-2 на 100 А — в жестянке из-под леденцов, на верстаке. Остался один. Беречь! Выбьет и этот — я не виноват, я предупреждал. И. К.
      `,
      en: txt`
        SIGN FOR EVERY KEY YOU TAKE!

        Generator (spare) ........ here
        Fuel depot ............... here
        Kennel (spare) ........... here
        Radio room ............... Markova has it
        Lab ...................... Gromov has it (and the code)
        Drilling shed ............ not locked

        [A note pinned to the board:]
        PN-2 100 A fuses: in the boiled-sweet tin on the workbench. One left. Look after it! If that one goes too, it isn't my fault, I warned you. I. K.
      `,
    },
  },

  ch2_depot_note: {
    chapter: 2, kind: 'note', date: '09.12.1990',
    place: 'Severny: the fuel depot, the tally board inside the gate',
    author: 'I. T. Karpenko, diesel mechanic',
    title: { ru: 'Ведомость склада ГСМ', en: 'Fuel depot tally' },
    body: {
      ru: txt`
        СКЛАД ГСМ. КУРИТЬ ЗАПРЕЩЕНО!

        Дизтопливо: бочек полных — 31, пустых — 9.
        Канистры 20 л, налитые: 4 — у ворот.
        Бензин для «Бурана»: 6 бочек.
        Масло: 3 бочки.

        [Карандашом, ниже:]
        09.12. Медведь повадился к складу. Жрёт что-то за бочками у задней стены. Смотреть не пошёл.
        Ракету он не любит — уходит. Из карабина в воздух не стрелять: только злится. И. К.
      `,
      en: txt`
        FUEL DEPOT. NO SMOKING!

        Diesel: full drums 31, empty 9.
        20 l jerrycans, filled: 4, by the gate.
        Petrol for the Buran: 6 drums.
        Oil: 3 drums.

        [In pencil, below:]
        09.12. A bear has taken to coming to the depot. It's eating something behind the drums by the back wall. I didn't go and look.
        It doesn't like a flare: it goes off. Don't fire the carbine into the air: that only makes it angry. I. K.
      `,
    },
  },

  ch2_tamara_note: {
    chapter: 2, kind: 'note', date: '13.12.1990',
    place: 'Severny: the mess hut, on the serving hatch',
    author: 'T. I. Koltsova, cook',
    title: { ru: 'Записка Тамары Ивановны', en: 'Tamara Ivanovna\'s note' },
    body: {
      ru: txt`
        Меню на 12 декабря: щи из квашеной капусты, макароны по-флотски, компот из сухофруктов.

        Накрыла на одиннадцать человек, как всегда. Пришли трое: Олег Зайцев, Ирочка Шульга и Витя Лебедев. Сели на свои места. Не едят. Сидят ровно, руки на столе, смотрят на печку. От щей пар идёт, а от них — нет.
        Я им налила. Пусть сидят. Пока сидят — тихо. Как встанут, начинают ходить и звать.
        Анатолий Петрович кричал мне через окно, чтобы я шла в главный дом. Не пойду. Я тут двадцать лет всех кормлю, и их буду кормить. Они же не виноваты.

        Если вы с судна — не будите их. И свет резко не включайте: они от света поворачиваются.
        Т. И. Кольцова
      `,
      en: txt`
        Menu for 12 December: sauerkraut shchi, navy-style macaroni, dried-fruit compote.

        I laid places for eleven, as always. Three came: Oleg Zaitsev, little Ira Shulga and Vitya Lebedev. They sat down in their own places. They don't eat. They sit up straight with their hands on the table, looking at the stove. The soup steams. They don't.
        I served them. Let them sit. While they sit, it's quiet. When they get up, they start walking about and calling.
        Anatoly Petrovich shouted at me through the window to come to the main house. I won't. I've fed everyone here for twenty years, and I'll feed them. It isn't their fault.

        If you're from the ship, don't wake them. And don't put the light on suddenly: the light makes them turn.
        T. I. Koltsova
      `,
    },
  },

  // =========================================================================================
  // 3. ГОЛОСА: the station, the radio, the lab
  // =========================================================================================

  ch3_door_radio: {
    chapter: 3, kind: 'note', date: '15.12.1990',
    place: 'Severny: the main house, on the radio room door',
    author: 'E. S. Markova, radio operator',
    title: { ru: 'Записка на двери радиорубки', en: 'Note on the radio room door' },
    body: {
      ru: txt`
        НЕ СТУЧИТЕ.
        Я не открою. Ни Серёже, ни Павлу Григорьевичу, ни маме.
        Я знаю, что вы не вы.
        Л.
      `,
      en: txt`
        DON'T KNOCK.
        I won't open. Not for Seryozha, not for Pavel Grigoryevich, not for Mum.
        I know you're not you.
        L.
      `,
    },
  },

  ch3_markova_1: {
    chapter: 3, kind: 'journal', date: '01–06.12.1990',
    place: 'Severny: the radio room, by the transmitter',
    author: 'E. S. Markova, radio operator',
    title: { ru: 'Аппаратный журнал радиостанции, лист 1', en: 'The radio log, sheet 1' },
    body: {
      ru: txt`
        АППАРАТНЫЙ ЖУРНАЛ РАДИОСТАНЦИИ ПС «СЕВЕРНЫЙ»
        Радиооператор Маркова Е. С.

        01.12, 08:00. Диксон-радио. Метеосводка передана. Слышимость 5 баллов.
        01.12, 14:20. Диксон. Служебная начальника станции (о находке на куполе) передана.
        03.12, 09:10. Принята служебная для Громова: «Работы прекратить, сооружение не вскрывать, ждать представителя». Вручила лично. А. П. прочитал и сказал: «Хорошо». Ничего хорошего.
        06.12, 21:00. Диксон. Сводка передана. О спуске велено не сообщать. Не сообщила.

        [Ниже, мелко, для себя:]
        На курсах нас учили перед выходом в эфир считать до десяти: и микрофон проверишь, и руки перестанут дрожать. Я теперь считаю до десяти по любому поводу. Олег Зайцев после шахты сидит в кают-компании и смотрит на печку, а я считаю.
        Ночью, когда не спится, включаю станцию на нашей частоте и считаю вслух до ста. Все спят, эфир пустой, никто не слышит. Мне так спокойнее: в комнате есть голос.
      `,
      en: txt`
        RADIO LOG, POLAR STATION SEVERNY
        Radio operator E. S. Markova

        01.12, 08:00. Dikson Radio. Weather report sent. Readability 5.
        01.12, 14:20. Dikson. Station chief's official message (on the find on the ice cap) sent.
        03.12, 09:10. Received, official message for Gromov: "Stop work, do not open the structure, await a representative." Delivered by hand. A. P. read it and said: "Fine." Nothing about it is fine.
        06.12, 21:00. Dikson. Weather report sent. Told not to report the descent. Didn't report it.

        [Below, small, for herself:]
        On the course they taught us to count to ten before going on the air: it checks the microphone, and your hands stop shaking. Now I count to ten for any reason at all. Since the shaft, Oleg Zaitsev sits in the mess looking at the stove, and I count.
        At night, when I can't sleep, I switch the set on to our own frequency and count out loud to a hundred. Everyone's asleep, the air is empty, nobody hears. It calms me: there's a voice in the room.
      `,
    },
  },

  ch3_markova_2: {
    chapter: 3, kind: 'journal', date: '09–11.12.1990',
    place: 'Severny: the radio room, by the transmitter',
    author: 'E. S. Markova, radio operator',
    title: { ru: 'Аппаратный журнал радиостанции, лист 2', en: 'The radio log, sheet 2' },
    body: {
      ru: txt`
        09.12, 23:40. Частота станции. Считала вслух. На «семи» мне ответили: «восемь». Мужской голос. Потом «девять» — моим голосом. Я выключила станцию. Сидела до утра.

        10.12, 02:15. Вызов на частоте станции: голос Вити Лебедева, с купола, просит прислать людей. Рация Лебедева сломана с октября, я сама её чинила и не починила. Она лежит у Громова на столе.

        10.12, 22:00. Голос Карпенко. Зовёт Тамару Ивановну по имени-отчеству, вежливо, как он никогда не говорит.

        11.12. Поняла: они повторяют всё, что слышат. Каждое слово, каждым голосом. При них нельзя говорить ничего важного. Нельзя называть имена: они запоминают имена.
        Олег Зайцев сегодня назвал меня Леночкой. Так меня звала только бабушка, и только дома, в Устюге. Олег не мог этого знать.
      `,
      en: txt`
        09.12, 23:40. Station frequency. I was counting out loud. At "seven" someone answered: "eight". A man's voice. Then "nine", in my voice. I switched the set off. Sat up till morning.

        10.12, 02:15. A call on the station frequency: Vitya Lebedev's voice, from the ice cap, asking for people to be sent. Lebedev's walkie-talkie has been broken since October; I tried to mend it myself and couldn't. It's lying on Gromov's desk.

        10.12, 22:00. Karpenko's voice. Calling Tamara Ivanovna by her name and patronymic, politely, the way he never talks.

        11.12. I understand now: they repeat everything they hear. Every word, in every voice. Nothing that matters can be said in front of them. No names: they remember names.
        Today Oleg Zaitsev called me Lenochka. Only my grandmother called me that, and only at home, in Ustyug. Oleg couldn't have known.
      `,
    },
  },

  ch3_markova_3: {
    chapter: 3, kind: 'journal', date: '12–18.12.1990',
    place: 'Severny: the radio room, by the transmitter',
    author: 'E. S. Markova, radio operator',
    title: { ru: 'Аппаратный журнал радиостанции, лист 3', en: 'The radio log, sheet 3' },
    body: {
      ru: txt`
        12.12, 08:00. Сеанс с Диксоном. Хотела сказать, что у нас. Не смогла: за дверью кто-то повторял каждое моё слово на полсекунды позже. Сказала «сводка будет позже». Это последнее, что «Северный» сказал миру.
        Потом полезла на мачту и перерезала фидер антенны. Оно учится говорить нашими голосами. Пусть учится без антенны. Пусть не зовёт сюда людей.

        15.12. Станция обесточена, антенны нет. А в динамике считали. До ста, моим голосом. Я вынула лампы из приёмника. Считали дальше.

        17.12. Голубев не отвечает. Ершов в бане, топит печь. Я одна в доме. За дверью — я.

        18.12. Я слышу, как я за дверью считаю до ста и начинаю снова. Она сбилась на сорока семи. Я никогда не сбиваюсь. Значит, она — не я. Значит, я — здесь.
        Если вы пришли за нами — не чините антенну. Оно только этого и ждёт.
        Раз. Два. Три.
      `,
      en: txt`
        12.12, 08:00. Schedule with Dikson. I wanted to tell them what is happening here. I couldn't: outside the door someone was repeating every word I said, half a second behind me. I said "weather report will follow". That was the last thing Severny said to the world.
        Then I climbed the mast and cut the antenna feeder. It's learning to talk in our voices. Let it learn without an antenna. Let it not call people here.

        15.12. The set has no power and no antenna. And the speaker was counting. To a hundred, in my voice. I took the valves out of the receiver. It went on counting.

        17.12. Golubev doesn't answer. Ershov is in the banya, keeping the stove going. I'm alone in the house. Outside the door, there's me.

        18.12. I can hear myself outside the door, counting to a hundred and starting again. She lost count at forty-seven. I never lose count. So she isn't me. So I'm here.
        If you've come for us, don't mend the antenna. That's all it's waiting for.
        One. Two. Three.
      `,
    },
  },

  ch3_markova_count: {
    chapter: 3, kind: 'note', date: '18.12.1990',
    place: 'Severny: the radio room, a sheet under the desk lamp',
    author: 'E. S. Markova (the end is not her hand)',
    title: { ru: 'Лист со счётом', en: 'The counting sheet' },
    body: {
      ru: txt`
        [Лист из блокнота, исписанный цифрами, ровным почерком:]
        1 2 3 4 5 6 7 8 9 10
        11 12 13 14 15 16 17 18 19 20
        21 22 23 24 25 26 27 28 29 30
        31 32 33 34 35 36 37 38 39 40
        41 42 43 44 45 46 47 47 47 47
        47 47 47 47 47 47 47 47 47 47

        [Ниже почерк ломается, буквы крупные, с нажимом, рвут бумагу:]
        Громов Лебедев Зайцев Шульга Голубев Галиев Карпенко Ершов Кольцова Вануйто Маркова
        Волков Петров Кузнецов Павлов Семёныч Орлов Белов Ахметов Смирнов
        Никитин
        Никитин
        НИКИТИН
      `,
      en: txt`
        [A notebook page covered in numbers, in a neat hand:]
        1 2 3 4 5 6 7 8 9 10
        11 12 13 14 15 16 17 18 19 20
        21 22 23 24 25 26 27 28 29 30
        31 32 33 34 35 36 37 38 39 40
        41 42 43 44 45 46 47 47 47 47
        47 47 47 47 47 47 47 47 47 47

        [Below, the handwriting breaks down: big letters, pressed so hard they tear the paper:]
        Gromov Lebedev Zaitsev Shulga Golubev Galiev Karpenko Ershov Koltsova Vanuyto Markova
        Volkov Petrov Kuznetsov Pavlov Semyonych Orlov Belov Akhmetov Smirnov
        Nikitin
        Nikitin
        NIKITIN
      `,
    },
  },

  ch3_lab_analysis: {
    chapter: 3, kind: 'report', date: '07–09.12.1990',
    place: 'Severny: the lab, on the bench by the cold room',
    author: 'I. V. Shulga, hydrochemical engineer',
    title: { ru: 'Протокол анализа № 14', en: 'Analysis report No. 14' },
    body: {
      ru: txt`
        ЛАБОРАТОРИЯ ПС «СЕВЕРНЫЙ»
        Протокол анализа № 14

        Образцы: керн К-1 … К-6. Отбор: шахта № 3, нижний ярус (ледяная полость), ручной бур, глубина отбора 0,2–1,4 м. Дата отбора: 06.12.90.
        Исполнитель: инж.-гидрохимик Шульга И. В.

        1. Лёд плотный, тёмный, на просвет почти чёрный. Тёмные включения волокнистого строения — до 40 % объёма образца.
        2. Микроскопия (×400): включения — ткань. Клеточное строение, ядра, межклеточные связи. Не растительная. Сходства с известными мне тканями нет.
        3. Образец К-3 выдерживался при −40 °C 48 часов. Клетки живы и подвижны. Повторяю: при минус сорока клетки живы и движутся. Цитоплазма не замерзает.
        4. При отеплении до −5 °C подвижность резко возрастает. Объём образца К-3 за 3 часа увеличился на 6 %, образец прирос к стенке кюветы.
        5. Возраст льда по слоистости — не менее 10 000 лет.

        Вывод: образцы хранить при −40 °C и ниже, в морозильной камере, под замком. В жилые помещения не вносить. Отепление недопустимо.

        [От руки, внизу:]
        Анатолий Петрович, я вас прошу: сожгите это. Оно растёт к теплу. Я оставляю кювету на середине стола, а утром нахожу её на краю, ближе к печке. Ближе ко мне.
        И. Ш.
      `,
      en: txt`
        SEVERNY STATION LABORATORY
        Analysis report No. 14

        Samples: cores K-1 to K-6. Taken in shaft No. 3, lower level (the ice cavity), hand corer, depth 0.2 to 1.4 m. Date taken: 06.12.90.
        Analyst: hydrochemical engineer I. V. Shulga.

        1. The ice is dense and dark, almost black against the light. Dark inclusions of fibrous structure, up to 40% of the sample's volume.
        2. Microscopy (x400): the inclusions are tissue. Cellular structure, nuclei, connections between cells. Not plant tissue. It resembles no tissue known to me.
        3. Sample K-3 was kept at −40 °C for 48 hours. The cells are alive and moving. I repeat: at forty below, the cells are alive and moving. The cytoplasm does not freeze.
        4. Warmed to −5 °C, their activity rises sharply. In 3 hours sample K-3 grew by 6% in volume and attached itself to the wall of its dish.
        5. Age of the ice, by its layering: at least 10,000 years.

        Conclusion: keep the samples at −40 °C or below, in the cold room, under lock. Do not bring them into living quarters. They must not be allowed to warm.

        [Handwritten, at the bottom:]
        Anatoly Petrovich, I beg you: burn it. It grows towards warmth. I leave the dish in the middle of the table, and in the morning I find it at the edge, nearer the stove. Nearer me.
        I. Sh.
      `,
    },
  },

  ch3_tape_shaft3: {
    chapter: 3, kind: 'tape', date: '06.12.1990',
    place: 'Severny: the lab, the cassette in the recorder on the desk (prop tape_shaft3)',
    author: 'Recorded by A. P. Gromov',
    title: { ru: 'Кассета «06.12.90. Шахта 3»', en: 'Cassette "06.12.90. Shaft 3"' },
    body: {
      ru: txt`
        [Магнитофонная кассета. На наклейке рукой Громова: «06.12.90. Шахта 3». Голоса: Громов (Г.), Лебедев (Л.), Зайцев (З.).]

        Г.: Шестое декабря, одиннадцать двадцать. Мы в шахте номер три. Со мной Лебедев и Зайцев.
        Г.: Скобы держат. Стены бетонные, в инее. Тут надпись трафаретом: «Объект-7. Вход воспрещён».
        З.: Воспрещён. Ну всё, Анатолий Петрович, пошли обратно. [Смеётся.]
        Л.: Толя, внизу свет... Нет, это наш фонарь отражается.
        Г.: Внизу коридор. Лампы целые. Красная звезда над дверью. Как будто они вышли вчера.
        [Шаги, эхо.]
        Г.: Столовая. Тарелки на столах, ложки в тарелках. Они ушли, не доев.
        Г.: Камеры. Стеклянные. Витя, свет сюда... В них люди. Во льду. У них открыты глаза.
        Л.: Толя... этот повернул голову. Он повернул голову!
        Г.: Это лёд. Это преломление, Витя, это свет так падает. Идём дальше.
        [Шаги, долго. Капает вода.]
        Г.: Ниже — пещера. Лёд тёмный, как зрачок. Я снял перчатку... Он тёплый. Лёд тёплый.
        З.: [Неразборчиво.] ...зовут... меня зовут...
        Г.: Олег? Олег, ты где? Олег!
        [Пауза, 40 секунд. Капает вода.]
        ГОЛОС (голосом Громова): Олег? Олег, ты где? Олег!
        Г.: Кто это сказал? Витя... кто это сказал моим голосом?
        [Конец записи.]
      `,
      en: txt`
        [A cassette. On the label, in Gromov's hand: "06.12.90. Shaft 3". Voices: Gromov (G.), Lebedev (L.), Zaitsev (Z.).]

        G.: The sixth of December, eleven twenty. We're in Shaft Three. Lebedev and Zaitsev are with me.
        G.: The rungs hold. Concrete walls, frosted over. There's a stencil here: "Object 7. No entry."
        Z.: No entry. That's that, then, Anatoly Petrovich, let's go back up. [Laughs.]
        L.: Tolya, there's a light down there... No, it's our own torch reflecting.
        G.: A corridor at the bottom. The lamps are intact. A red star over the door. As if they left yesterday.
        [Footsteps, echo.]
        G.: A canteen. Plates on the tables, spoons in the plates. They left without finishing.
        G.: Chambers. Glass ones. Vitya, light over here... There are people in them. In the ice. Their eyes are open.
        L.: Tolya... that one turned its head. It turned its head!
        G.: It's the ice. It's refraction, Vitya, it's the way the light falls. Let's go on.
        [Footsteps, for a long time. Water dripping.]
        G.: Below there's a cave. The ice is dark, like a pupil. I've taken my glove off... It's warm. The ice is warm.
        Z.: [Indistinct.] ...calling... someone's calling me...
        G.: Oleg? Oleg, where are you? Oleg!
        [A pause, 40 seconds. Water dripping.]
        A VOICE (in Gromov's voice): Oleg? Oleg, where are you? Oleg!
        G.: Who said that? Vitya... who said that in my voice?
        [End of recording.]
      `,
    },
  },

  ch3_kennel_note: {
    chapter: 3, kind: 'note', date: '14.12.1990',
    place: 'Severny: the kennel, nailed up inside the door',
    author: 'Ye. N. Vanuyto, dog handler',
    title: { ru: 'Записка каюра', en: 'The dog handler\'s note' },
    body: {
      ru: txt`
        Кто найдёт — читай.

        Собаки пятый день не едят. Смотрят на купол и воют. Найда, старшая, позавчера перегрызла цепь и ушла туда. Утром вернулась. Не лает, не ест, хвостом не машет. Стоит и смотрит на меня. Пара изо рта нет. Я её запер в дальнем загоне.

        Дед мой говорил: на этом острове лёд копать нельзя. Подо льдом спит тот, кто ест тепло. Разбудишь — он придёт за теплом и будет звать голосами тех, кого взял. Отец мой возил сюда русских военных на собаках, давно, когда Гагарин летал. Военные ушли под лёд. Не вышел никто. Отец две недели ждал у купола.
        Громов смеялся. Теперь не смеётся.

        Я тут, с собаками. Пока они живые — тут тепло.
        Если Найда подойдёт к тебе и будет стоять — не гладь её. Это уже не Найда.
        Ефим Вануйто
      `,
      en: txt`
        Whoever finds this, read it.

        The dogs haven't eaten for five days. They look at the ice cap and howl. Naida, the eldest, chewed through her chain the day before yesterday and went up there. She came back in the morning. She doesn't bark, doesn't eat, doesn't wag. She stands and looks at me. No steam from her mouth. I've shut her in the far pen.

        My grandfather used to say: you mustn't dig the ice on this island. Under the ice sleeps the one who eats warmth. Wake him and he'll come for warmth, and call you in the voices of the ones he's taken. My father brought Russian soldiers here by dog sled, long ago, when Gagarin flew. The soldiers went down under the ice. Not one came out. My father waited at the ice cap for two weeks.
        Gromov laughed. He doesn't laugh now.

        I'm here, with the dogs. While they're alive, it's warm in here.
        If Naida comes up to you and just stands there, don't stroke her. That isn't Naida any more.
        Yefim Vanuyto
      `,
    },
  },

  ch3_banya_note: {
    chapter: 3, kind: 'note', date: '16.12.1990',
    place: 'Severny: the banya, on the door to the changing room',
    author: 'Dr P. G. Ershov',
    title: { ru: 'Записка на двери бани', en: 'Note on the banya door' },
    body: {
      ru: txt`
        НЕ ДАВАЙТЕ ПЕЧИ ПОГАСНУТЬ.

        В парилке — Галиев и Карпенко. Пока жарко, они не двигаются: сидят на полке и спят, или что у них теперь вместо сна. Сильный жар их держит, как нас держит холод.
        Топлю каждые три часа. Дрова в предбаннике, у стены.

        Если печь погасла и в парилке стучат — не открывайте. Растопите печь, если успеете. Не успеваете — уходите и подоприте дверь.

        П. Ершов, врач. 16.12.90
      `,
      en: txt`
        DON'T LET THE STOVE GO OUT.

        Galiev and Karpenko are in the steam room. While it's hot, they don't move: they sit on the bench and sleep, or whatever they have now instead of sleep. Strong heat holds them the way the cold holds us.
        I stoke it every three hours. The firewood is in the changing room, against the wall.

        If the stove has gone out and there's knocking in the steam room, don't open it. Light the stove, if you have time. If you don't, leave, and wedge the door shut.

        P. Ershov, doctor. 16.12.90
      `,
    },
  },

  ch3_ershov_notes: {
    chapter: 3, kind: 'report', date: '07–15.12.1990',
    place: 'Severny: the banya, the changing room, in the doctor\'s bag',
    author: 'Dr P. G. Ershov',
    title: { ru: 'Медицинский журнал: Зайцев О. И.', en: 'Medical log: O. I. Zaitsev' },
    body: {
      ru: txt`
        МЕДИЦИНСКИЙ ЖУРНАЛ ПС «СЕВЕРНЫЙ»
        Зайцев Олег Игоревич, 34 г., буровик.

        07.12. T тела 34,1°. Пульс 44. Жалоб нет. Говорит мало, заторможен. Шок?
        08.12. T 31,0°. Пульс 12 (!). Сознание ясное. Ходит. На морозе дыхание не определяется: пара нет. От еды отказывается.
        09.12. T 22°. Пульс не определяется. Ходит, отвечает на вопросы. Вернее, повторяет мои вопросы — моим голосом, с моей интонацией.
        10.12. На предплечьях и шее кристаллы льда. Растут изнутри, через кожу, как иней по стеклу. Боли не чувствует. Ногти посинели и удлинились.
        12.12. Нижняя челюсть расходится по средней линии. Крови нет. Зубы...
        [Запись зачёркнута.]
        15.12. Я врач двенадцать лет. Я записываю это, чтобы было видно, что я не сошёл с ума. Это не обморожение и не болезнь. Тело не умирает — его переделывают. Под тепло: они слышат тепло, как собака слышит запах. И под голос: они зовут, чтобы мы вышли к ним.
        Жар их останавливает. Огонь убивает. Холод будит.
      `,
      en: txt`
        MEDICAL LOG, SEVERNY STATION
        Zaitsev, Oleg Igorevich, 34, driller.

        07.12. Body temperature 34.1°. Pulse 44. No complaints. Says little, sluggish. Shock?
        08.12. T 31.0°. Pulse 12 (!). Fully conscious. Walking. In the frost his breathing can't be detected: no vapour. Refuses food.
        09.12. T 22°. No detectable pulse. Walks, answers questions. Or rather, repeats my questions back to me, in my voice, with my intonation.
        10.12. Ice crystals on his forearms and neck. They grow from inside, out through the skin, like frost across a window. He feels no pain. The nails have gone blue and grown longer.
        12.12. The lower jaw is splitting along the midline. No blood. The teeth...
        [The entry is crossed out.]
        15.12. I have been a doctor for twelve years. I'm writing this down so that it can be seen I haven't gone mad. This isn't frostbite and it isn't a disease. The body isn't dying: it is being remade. For warmth: they hear warmth the way a dog hears a scent. And for the voice: they call so that we'll come out to them.
        Heat stops them. Fire kills them. Cold wakes them.
      `,
    },
  },

  // =========================================================================================
  // 4. ОБЪЕКТ-7: the drilling shed, then the facility under the ice cap (1962-63)
  // =========================================================================================

  ch4_drill_log: {
    chapter: 4, kind: 'report', date: '20.11–10.12.1990',
    place: 'Severny ice cap: the drilling shed, on the rig\'s console',
    author: 'V. N. Lebedev, drilling master',
    title: { ru: 'Буровой журнал, скважина К-2', en: 'Drilling log, borehole K-2' },
    body: {
      ru: txt`
        БУРОВОЙ ЖУРНАЛ. Скважина К-2, купол о. Северный. Буровой мастер Лебедев В. Н.

        20.11. 0–4,2 м. Фирн. Норма.
        22.11. До 11,5 м. Фирн, лёд. Простой 6 ч: примерзание снаряда.
        25.11. До 28,0 м. Лёд.
        27.11. До 39,6 м. В керне с 37 м — тёмные прожилки. Шульга смотрела: пыль.
        28.11. 41,7 м. УПОР. Снаряд не идёт. В коронке — бетонная крошка, ржавая арматура. Записал. Сам не поверил.
        29.11–05.12. Расширение скважины паром до шурфа 1,2 м. Вскрыта бетонная плита с люком. Под люком колодец, железные скобы вниз. Трафарет: «ШАХТА № 3. ВЕНТ.»
        06.12. Спуск: Громов, Лебедев, Зайцев. В нижней полости ручным буром отобрано шесть кернов.
        07.12. Бурения нет.
        09.12. Бурения нет. Ходил вниз один, ночью. Не знаю зачем. Тянет.
        10.12. Иду вниз. Там тепло.
      `,
      en: txt`
        DRILLING LOG. Borehole K-2, Severny ice cap. Drilling master V. N. Lebedev.

        20.11. 0 to 4.2 m. Firn. Normal.
        22.11. To 11.5 m. Firn, ice. 6 h lost: drill froze in.
        25.11. To 28.0 m. Ice.
        27.11. To 39.6 m. Dark streaks in the core from 37 m. Shulga looked: dust.
        28.11. 41.7 m. REFUSAL. Drill won't go on. In the crown: concrete grit, rusted rebar. Logged it. Didn't believe it myself.
        29.11 to 05.12. Borehole widened with steam to a 1.2 m pit. Concrete slab with a hatch uncovered. Under the hatch, a well, iron rungs going down. Stencil: "SHAFT No. 3. VENT."
        06.12. Descent: Gromov, Lebedev, Zaitsev. Six cores taken with the hand corer in the lower cavity.
        07.12. No drilling.
        09.12. No drilling. Went down alone, at night. Don't know why. It pulls.
        10.12. Going down. It's warm there.
      `,
    },
  },

  ch4_gromov_last: {
    chapter: 4, kind: 'journal', date: '12.12.1990',
    place: 'Severny ice cap: the drilling shed, on the winch by the hatch',
    author: 'A. P. Gromov, station chief',
    title: { ru: 'Последняя запись Громова', en: 'Gromov\'s last entry' },
    body: {
      ru: txt`
        12 декабря, девять утра. Буровая.

        Ухожу вниз. Ночью меня звала Надя. Надя умерла четыре года назад в Ленинграде, а я был на зимовке и не успел. Я знаю, что это не она. Оно знает всё, что знаем мы: взяло это у Олега, у Вити, у меня. Но говорит оно так, как говорила она: «Толя, иди домой».

        Керн я не сжёг. Пусть это сделают другие.

        Для тех, кто придёт. Внизу, за реакторным залом, — пещера, и в ней оно. Свод пещеры держат три ледяные колонны. Военные в шестьдесят третьем это знали: на схеме в кабинете начальника колонны обведены красным. Если обрушить свод, оно уйдёт под лёд ещё на тридцать лет. А может, навсегда.
        Я иду не за этим. Я иду домой.
        Простите меня.
        А. Громов
      `,
      en: txt`
        12 December, nine in the morning. The drilling shed.

        I'm going down. In the night Nadya called me. Nadya died four years ago in Leningrad, while I was away wintering and didn't get back in time. I know it isn't her. It knows everything we know: it took it from Oleg, from Vitya, from me. But it speaks the way she spoke: "Tolya, come home."

        I haven't burned the core. Let others do it.

        For whoever comes. Down below, past the reactor hall, is a cave, and in it is the thing. The cave's roof is held up by three pillars of ice. The army knew it in '63: on the plan in the commandant's office the pillars are ringed in red. Bring the roof down, and it will sink back under the ice for another thirty years. Perhaps for ever.
        That isn't what I'm going for. I'm going home.
        Forgive me.
        A. Gromov
      `,
    },
  },

  ch4_poster_slogan: {
    chapter: 4, kind: 'poster', date: '1961',
    place: 'Object 7: the canteen, a banner over the serving line',
    author: 'Political department, Object 7',
    title: { ru: 'Транспарант в столовой', en: 'Banner in the canteen' },
    body: {
      ru: txt`
        НЫНЕШНЕЕ ПОКОЛЕНИЕ СОВЕТСКИХ ЛЮДЕЙ БУДЕТ ЖИТЬ ПРИ КОММУНИЗМЕ!
        (Программа КПСС, XXII съезд)

        [Ниже, мелом по бетону:]
        ДОЖИВЁМ?
      `,
      en: txt`
        THE PRESENT GENERATION OF SOVIET PEOPLE SHALL LIVE UNDER COMMUNISM!
        (Programme of the CPSU, 22nd Congress)

        [Below, in chalk on the concrete:]
        WILL WE LIVE THAT LONG?
      `,
    },
  },

  ch4_poster_secrecy: {
    chapter: 4, kind: 'poster', date: '1962',
    place: 'Object 7: the barracks corridor',
    author: 'Political department, Object 7',
    title: { ru: 'Плакат в казарме', en: 'Poster in the barracks' },
    body: {
      ru: txt`
        ЧТО УСЛЫШАЛ ЗДЕСЬ — ОСТАВЬ ЗДЕСЬ!
        О работе объекта — ни слова: ни в письмах, ни дома, ни во сне.
        Бдительность — оружие советского воина.

        [Карандашом, поперёк плаката:]
        А если оно само говорит?
      `,
      en: txt`
        WHAT YOU HEAR HERE, YOU LEAVE HERE!
        Not a word about the work of the Object: not in letters, not at home, not in your sleep.
        Vigilance is the Soviet soldier's weapon.

        [In pencil, across the poster:]
        And if it does the talking itself?
      `,
    },
  },

  ch4_poster_gagarin: {
    chapter: 4, kind: 'poster', date: '1961',
    place: 'Object 7: the corridor outside the commandant\'s office',
    author: 'Political department, Object 7',
    title: { ru: 'Плакат «12 апреля»', en: 'Poster: "12 April"' },
    body: {
      ru: txt`
        12 АПРЕЛЯ 1961 ГОДА — ПЕРВЫЙ В МИРЕ ПОЛЁТ ЧЕЛОВЕКА В КОСМОС!
        Слава советской науке! Слава Юрию Гагарину!

        Сегодня — орбита, завтра — звёзды.
        Путь к далёким мирам советский человек пройдёт во сне длиною в годы.
        Проект «Анабиоз» — наш вклад в покорение космоса!
      `,
      en: txt`
        12 APRIL 1961: THE FIRST HUMAN FLIGHT INTO SPACE IN THE HISTORY OF THE WORLD!
        Glory to Soviet science! Glory to Yuri Gagarin!

        Today, orbit. Tomorrow, the stars.
        The Soviet man will travel to distant worlds in a sleep that lasts for years.
        Project Anabiosis: our part in the conquest of space!
      `,
    },
  },

  ch4_sign_cryo: {
    chapter: 4, kind: 'poster', date: '1962',
    place: 'Object 7: over the door of the cryo hall',
    author: 'Object 7',
    title: { ru: 'Табличка у криозала', en: 'Sign at the cryo hall' },
    body: {
      ru: txt`
        КРИОЗАЛ
        ПО СТЕКЛУ КАМЕР НЕ СТУЧАТЬ.
        С ИСПЫТУЕМЫМИ НЕ РАЗГОВАРИВАТЬ.
        НА ОКЛИК ПО ИМЕНИ НЕ ОТВЕЧАТЬ.
      `,
      en: txt`
        CRYO HALL
        DO NOT KNOCK ON THE GLASS OF THE CHAMBERS.
        DO NOT TALK TO THE SUBJECTS.
        DO NOT ANSWER IF CALLED BY NAME.
      `,
    },
  },

  ch4_sign_reactor: {
    chapter: 4, kind: 'poster', date: '1962',
    place: 'Object 7: the reactor hall, over the switchboard',
    author: 'Object 7',
    title: { ru: 'Табличка в реакторном зале', en: 'Sign in the reactor hall' },
    body: {
      ru: txt`
        РЕАКТОРНЫЙ ЗАЛ
        ОСТОРОЖНО! РАДИАЦИЯ!
        Включение автоматов распределительного щита — только в порядке, установленном инструкцией дежурного электрика.
        Нарушение порядка вызывает срабатывание защиты и обесточивание объекта.
      `,
      en: txt`
        REACTOR HALL
        DANGER! RADIATION!
        The switchboard breakers are to be closed only in the order laid down in the duty electrician's instructions.
        Closing them out of order trips the protection and cuts power to the whole facility.
      `,
    },
  },

  ch4_sign_sector: {
    chapter: 4, kind: 'poster', date: '1962',
    place: 'Object 7: on the blast doors to Sector G (the ice cave)',
    author: 'Object 7',
    title: { ru: 'Табличка на гермоворотах', en: 'Sign on the blast doors' },
    body: {
      ru: txt`
        СЕКТОР «Г»
        ВХОД ВОСПРЕЩЁН!
        Допуск — по пропускам формы № 1 за подписью начальника объекта.
        Нарушитель задерживается без предупреждения.
      `,
      en: txt`
        SECTOR G
        NO ENTRY!
        Access only with a Form No. 1 pass signed by the commandant.
        Trespassers will be detained without warning.
      `,
    },
  },

  ch4_order_41: {
    chapter: 4, kind: 'report', date: '02.06.1962',
    place: 'Object 7: the guard post at the foot of Shaft 3, pinned to the wall',
    author: 'Colonel A. V. Sokolov, commandant',
    title: { ru: 'Приказ № 41 о допуске в сектор «Г»', en: 'Order No. 41: access to Sector G' },
    body: {
      ru: txt`
        СЕКРЕТНО
        ПРИКАЗ начальника Объекта-7 № 41
        2 июня 1962 г.
        О режиме допуска в сектор «Г»

        1. С 3 июня 1962 г. ледяную полость нижнего горизонта (отм. −60) именовать сектором «Г».
        2. Допуск в сектор «Г» — только по пропускам формы № 1 за моей подписью. Охрану гермоворот сектора нести круглосуточно, по два человека.
        3. Сведения об объекте «Гость» составляют государственную тайну особой важности. Употреблять это название вне служебных помещений запрещаю.
        4. О каждом случае, когда военнослужащий слышит из сектора «Г» голоса, в том числе голоса лиц, отсутствующих на объекте, немедленно докладывать начальнику особого отдела.
        5. На оклик по имени из сектора «Г» не отвечать. Часовым не покидать пост, кто бы их ни звал.
        6. Приказ довести до всего личного состава под роспись.

        Начальник Объекта-7
        полковник А. Соколов
      `,
      en: txt`
        SECRET
        ORDER No. 41 of the commandant of Object 7
        2 June 1962
        On access to Sector G

        1. From 3 June 1962 the ice cavity on the lower level (elevation −60) is to be called Sector G.
        2. Access to Sector G only with a Form No. 1 pass bearing my signature. The sector's blast doors are to be guarded round the clock, two men at a time.
        3. Information about the object called the Guest is a state secret of special importance. I forbid the use of that name outside the work areas.
        4. Every case of a serviceman hearing voices from Sector G, including the voices of persons not present at the Object, is to be reported at once to the head of the special department.
        5. Do not answer if called by name from Sector G. Sentries are not to leave their posts, whoever calls them.
        6. This order is to be made known to all personnel, against signature.

        Commandant, Object 7
        Colonel A. Sokolov
      `,
    },
  },

  ch4_guest_report: {
    chapter: 4, kind: 'report', date: '20.05.1962',
    place: 'Object 7: the archive, file 63/7-G',
    author: 'Professor L. A. Shtern, scientific director',
    title: { ru: 'Докладная записка о находке на нижнем горизонте', en: 'Memorandum on the find on the lower level' },
    body: {
      ru: txt`
        СОВ. СЕКРЕТНО. Экз. № 2.
        Начальнику Объекта-7 полковнику Соколову А. В.

        ДОКЛАДНАЯ ЗАПИСКА

        17 мая 1962 г. при проходке разведочной штольни на отметке −60 вскрыта естественная полость во льду, около 70 м в поперечнике. Свод полости опирается на три ледяные колонны.
        В толще льда у дальней стены — тёмная масса неустановленной природы, около 40 м в поперечнике. Строение волокнистое, ветвящееся: напоминает корневую систему или нервную. Температура массы −11 °C при температуре окружающего льда −19 °C.
        Сейсмограф фиксирует медленную пульсацию массы: одно сокращение в 11 минут.
        Возраст вмещающего льда — не менее 10 000 лет.

        Отмечу особо: у испытуемых криозала, находящихся в анабиозе и клинически мёртвых, энцефалограф с 17 мая регистрирует активность, совпадающую по ритму с пульсацией массы.

        Рабочие и инженеры между собой называют массу «Гостем». Предлагаю принять это наименование и в документах.
        Прошу разрешения продолжить исследование. Значение находки для темы «Анабиоз» трудно переоценить.

        Научный руководитель темы
        д. м. н. Л. А. Штерн
      `,
      en: txt`
        TOP SECRET. Copy No. 2.
        To the commandant of Object 7, Colonel A. V. Sokolov.

        MEMORANDUM

        On 17 May 1962, while driving an exploratory gallery at elevation −60, we broke into a natural cavity in the ice, about 70 m across. The cavity's roof rests on three ice pillars.
        In the body of the ice by the far wall is a dark mass of unknown nature, about 40 m across. Its structure is fibrous and branching, like a root system, or a nervous one. The mass is at −11 °C; the ice around it at −19 °C.
        The seismograph records a slow pulsation of the mass: one contraction every 11 minutes.
        Age of the surrounding ice: at least 10,000 years.

        I draw your particular attention to this: since 17 May the encephalograph has recorded activity in the subjects of the cryo hall, who are in anabiosis and clinically dead, in the same rhythm as the mass's pulsation.

        Among themselves the workers and engineers call the mass "the Guest". I propose that we use the name in our documents too.
        I request permission to continue the investigation. The importance of the find for Project Anabiosis can hardly be overstated.

        Scientific director of the project
        L. A. Shtern, Doctor of Medical Sciences
      `,
    },
  },

  ch4_anabiosis_report: {
    chapter: 4, kind: 'report', date: '30.09.1962',
    place: 'Object 7: the archive, file 63/7-G',
    author: 'Prof. L. A. Shtern and Col. A. V. Sokolov',
    title: { ru: 'Отчёт по теме «Анабиоз» за III квартал 1962 г.', en: 'Project Anabiosis: report for the third quarter of 1962' },
    body: {
      ru: txt`
        СОВ. СЕКРЕТНО. ОСОБОЙ ВАЖНОСТИ.
        ОТЧЁТ о ходе работ по теме «Анабиоз» за III квартал 1962 г. (выписка)

        Цель темы: длительное сохранение жизнеспособности человека в состоянии глубокого охлаждения — для полётов длительностью в годы и для особых задач Министерства обороны.

        Испытуемых всего: 34 (осуждённые к высшей мере наказания — 27, добровольцы из числа военнослужащих — 7).
        Введено в анабиоз: 34.
        Попыток выведения: 21.
        Восстановлена сердечная деятельность: 6. Из них живы на 30.09: 1.
        Сохранена двигательная активность при отсутствии сердечной деятельности: 9 (выделены в группу «Б»).

        Испытуемые группы «Б» не нуждаются ни в пище, ни в тепле. Температура тела равна температуре помещения. Речь сохранена частично: повторяют слова персонала голосом персонала. До 20 часов в сутки стоят неподвижно, обратившись лицом в сторону сектора «Г».
        Связь состояния группы «Б» с объектом «Гость» считать установленной.

        Предложение: работы продолжить, группу «Б» изучать. Охрану криозала усилить.

        Научный руководитель темы д. м. н. Л. А. Штерн
        Начальник Объекта-7 полковник А. В. Соколов
      `,
      en: txt`
        TOP SECRET. OF SPECIAL IMPORTANCE.
        REPORT on the progress of Project Anabiosis, third quarter of 1962 (extract)

        Aim of the project: to keep a human being viable for long periods in a state of deep cooling, for flights lasting years and for special tasks of the Ministry of Defence.

        Subjects in all: 34 (sentenced to death, 27; volunteers from the armed forces, 7).
        Placed in anabiosis: 34.
        Revivals attempted: 21.
        Heart activity restored: 6. Of these, alive on 30.09: 1.
        Able to move with no heart activity: 9 (designated Group B).

        Group B subjects need neither food nor warmth. Their body temperature equals the temperature of the room. Speech is partly retained: they repeat the staff's words, in the staff's voices. For up to 20 hours a day they stand motionless, facing in the direction of Sector G.
        The connection between Group B's condition and the object called the Guest is to be considered established.

        Proposal: continue the work and study Group B. Strengthen the guard on the cryo hall.

        Scientific director, L. A. Shtern, Doctor of Medical Sciences
        Commandant, Object 7, Colonel A. V. Sokolov
      `,
    },
  },

  ch4_subject_14: {
    chapter: 4, kind: 'report', date: '14.10.1962',
    place: 'Object 7: the cryo hall, the records cabinet',
    author: 'Medical unit, Object 7',
    title: { ru: 'Учётная карта испытуемого № 14', en: 'Subject record card No. 14' },
    body: {
      ru: txt`
        УЧЁТНАЯ КАРТА ИСПЫТУЕМОГО № 14

        Ф. И. О.: Сидорчук Пётр Аверьянович, 1924 г. р.
        Осуждён по ст. 102 УК РСФСР (умышленное убийство при отягчающих обстоятельствах). Высшая мера наказания заменена участием в испытаниях по личному заявлению.
        Введён в анабиоз: 11.02.1962, криокамера № 14.
        Выведен: 30.08.1962.
        Состояние после выведения: группа «Б». Сердечная деятельность отсутствует. Двигательная активность сохранена. T тела −4 °C.
        Речь: повторяет слова персонала.

        14.10.62. В ночь на 14 октября голосом ефрейтора Мальцева позвал часового к камере. Часовой, рядовой Ковалёв, камеру открыл. Ефрейтор Мальцев в эту ночь находился в карауле на поверхности.
        Рядовой Ковалёв в лазарете: обморожение кистей и лица III–IV степени — от прикосновения испытуемого.
        Меры: камеру № 14 заварить. Часовым у криокамер ключей не выдавать.

        Капитан м/с В. Беляева
      `,
      en: txt`
        SUBJECT RECORD CARD No. 14

        Name: Sidorchuk, Pyotr Averyanovich, born 1924.
        Convicted under Article 102 of the RSFSR Criminal Code (aggravated murder). Death sentence commuted to participation in the trials, at his own request.
        Placed in anabiosis: 11.02.1962, cryo chamber No. 14.
        Revived: 30.08.1962.
        Condition after revival: Group B. No heart activity. Able to move. Body temperature −4 °C.
        Speech: repeats the staff's words.

        14.10.62. During the night of 14 October, in the voice of Lance Corporal Maltsev, he called the sentry to his chamber. The sentry, Private Kovalyov, opened the chamber. Lance Corporal Maltsev was on guard duty on the surface that night.
        Private Kovalyov is in the infirmary: frostbite of the hands and face, third to fourth degree, from the subject's touch.
        Measures: chamber No. 14 to be welded shut. Sentries at the cryo chambers are not to be issued keys.

        Captain (Medical Service) V. Belyaeva
      `,
    },
  },

  ch4_subject_22: {
    chapter: 4, kind: 'report', date: '03.07.1962',
    place: 'Object 7: the cryo hall, the records cabinet',
    author: 'Medical unit, Object 7',
    title: { ru: 'Учётная карта испытуемого № 22', en: 'Subject record card No. 22' },
    body: {
      ru: txt`
        УЧЁТНАЯ КАРТА ИСПЫТУЕМОГО № 22

        Ф. И. О.: Рябов Николай Ильич, 1934 г. р., старший лейтенант ВВС.
        Доброволец (группа подготовки к длительным полётам).
        Введён в анабиоз: 20.04.1962, криокамера № 22.
        Выведен: 01.06.1962. Сердечная деятельность восстановлена! Первый полный успех темы.

        05.06. Состояние удовлетворительное. Ест, шутит, спрашивает о жене. Жалоба одна: «Слышу, как подо льдом кто-то дышит».
        15.06. Отказ от пищи. T тела снижается: 33° — 29° — 18° при ясном сознании.
        02.07. Самовольно покинул криозал, прошёл в сектор «Г» через два поста. Часовые не стреляли: «он говорил голосом командира».
        03.07. Найден у входа в полость. Стоял лицом ко льду. В кармане гимнастёрки записка: «Не будите меня больше. Мне там тепло».

        Испытуемый № 22 оставлен у входа в полость. Попытки перемещения прекращены по приказу начальника объекта.

        Капитан м/с В. Беляева
      `,
      en: txt`
        SUBJECT RECORD CARD No. 22

        Name: Ryabov, Nikolai Ilyich, born 1934, Senior Lieutenant, Air Force.
        Volunteer (long-duration flight training group).
        Placed in anabiosis: 20.04.1962, cryo chamber No. 22.
        Revived: 01.06.1962. Heart activity restored! The project's first complete success.

        05.06. Condition satisfactory. Eats, jokes, asks after his wife. One complaint: "I can hear someone breathing under the ice."
        15.06. Refuses food. Body temperature falling: 33°, 29°, 18°, while fully conscious.
        02.07. Left the cryo hall without permission and went through two posts into Sector G. The sentries did not fire: "he spoke in the commanding officer's voice."
        03.07. Found at the entrance to the cavity, standing with his face to the ice. A note in his tunic pocket: "Don't wake me again. It's warm for me there."

        Subject No. 22 has been left at the entrance to the cavity. Attempts to move him have been stopped by order of the commandant.

        Captain (Medical Service) V. Belyaeva
      `,
    },
  },

  ch4_belyaeva_1: {
    chapter: 4, kind: 'journal', date: '24.10.1962',
    place: 'Object 7: the cryo hall, the medical officer\'s desk',
    author: 'Captain (Medical Service) V. N. Belyaeva',
    title: { ru: 'Дневник Веры Беляевой. Октябрь', en: 'Vera Belyaeva\'s diary: October' },
    body: {
      ru: txt`
        24 октября 1962.
        По радио — Куба. Американцы перекрыли море, наши корабли идут. Говорят, может начаться война. Солдаты шепчутся, что, если начнётся, нас здесь забудут первыми. Нас и так забыли.
        Соколов собрал офицеров и сказал: «Наша задача — не Куба. Наша задача — подготовить советского человека к полёту длиною в годы». Он красиво говорит и сам в это верит. Я ему завидую.
        Я ставлю градусники людям, у которых нет пульса, и записываю в карты: «состояние без изменений».
        Рябов стоит у входа в полость четвёртый месяц. Лицом ко льду. Его не трогают. Его боятся трогать. Я хожу к нему по средам, как к больному, и разговариваю с ним. Вчера он мне ответил. Моим голосом.
      `,
      en: txt`
        24 October 1962.
        On the radio: Cuba. The Americans have closed the sea and our ships are sailing on. They say war may break out. The soldiers whisper that if it does, we'll be the first to be forgotten down here. We've been forgotten already.
        Sokolov assembled the officers and said: "Our task is not Cuba. Our task is to prepare Soviet man for a flight that lasts for years." He speaks well, and he believes it himself. I envy him.
        I take the temperatures of people who have no pulse, and write on their cards: "condition unchanged".
        Ryabov has been standing at the entrance to the cavity for four months now. Face to the ice. Nobody touches him. They're afraid to. I go to him on Wednesdays, as I would a patient, and talk to him. Yesterday he answered me. In my voice.
      `,
    },
  },

  ch4_belyaeva_2: {
    chapter: 4, kind: 'journal', date: '01.01.1963',
    place: 'Object 7: the cryo hall, the medical officer\'s desk',
    author: 'Captain (Medical Service) V. N. Belyaeva',
    title: { ru: 'Дневник Веры Беляевой. Новый год', en: 'Vera Belyaeva\'s diary: New Year' },
    body: {
      ru: txt`
        1 января 1963.
        Новогодняя ночь. Соколов позвал меня к себе, налил коньяку из своего запаса. Говорил долго: о Гагарине, о том, что мы делаем то же, что и они, только наш космос — подо льдом.
        Показал мне свой сейф. «Здесь, Вера, всё, ради чего мы тут. Шифр — день и месяц, когда наш человек полетел в космос. Этот день я не забуду, даже когда забуду своё имя».
        Потом долго молчал, а потом сказал: «Ночью меня зовут голосом жены». Жена у него в Москве, живая. Я сказала, что меня зовут голосом мамы. А мама умерла в сорок втором, в Ленинграде, в блокаду.
        Мы выпили за Новый год. За то, чтобы нас отсюда выпустили.
      `,
      en: txt`
        1 January 1963.
        New Year's Eve. Sokolov invited me to his office and poured me some of his own cognac. He talked for a long time: about Gagarin, about how we're doing the same thing they did, only our space is under the ice.
        He showed me his safe. "Everything we're here for is in there, Vera. The combination is the day and the month our man flew into space. I won't forget that day even when I've forgotten my own name."
        Then he was silent for a long while, and then he said: "At night they call me in my wife's voice." His wife is in Moscow, alive. I told him they call me in my mother's voice. And my mother died in '42, in Leningrad, in the siege.
        We drank to the New Year. To being let out of here.
      `,
    },
  },

  ch4_belyaeva_3: {
    chapter: 4, kind: 'journal', date: '12.03.1963',
    place: 'Object 7: the cryo hall, the medical officer\'s desk',
    author: 'Captain (Medical Service) V. N. Belyaeva',
    title: { ru: 'Дневник Веры Беляевой. Март', en: 'Vera Belyaeva\'s diary: March' },
    body: {
      ru: txt`
        12 марта 1963.
        Сапёры не вернулись из сектора «Г». Лейтенант Кравец и шесть человек, с термитом. В январе Москва приказала уничтожить «Гостя», и вот — уничтожили семерых наших.
        В лазарете у меня девять человек из гарнизона с тем же, что у группы «Б». Днём лежат. Ночью встают и стоят у двери. Я запираю дверь снаружи и сижу под ней до утра.
        Рядовой Гусев, мальчик из Костромы, спросил меня сегодня, придёт ли весной борт. Я сказала: придёт.
        Соколов сказал: «Мы закроемся. Все. Пока мы держим ворота, оно не выйдет». Я врач. Я остаюсь со своими больными.
        Если это прочтут — знайте: мы не были чудовищами. Мы были послушными.
      `,
      en: txt`
        12 March 1963.
        The sappers haven't come back from Sector G. Lieutenant Kravets and six men, with the thermite. In January Moscow ordered the Guest destroyed, and so seven of ours have been destroyed instead.
        In the infirmary I have nine men from the garrison with what Group B has. By day they lie still. At night they get up and stand at the door. I lock the door from outside and sit against it until morning.
        Today Private Gusev, a boy from Kostroma, asked me whether a ship will come in the spring. I told him it will.
        Sokolov said: "We'll shut ourselves in. All of us. As long as we hold the doors, it won't get out." I'm a doctor. I'm staying with my patients.
        If anyone reads this, know that we were not monsters. We were obedient.
      `,
    },
  },

  ch4_gusev_letter: {
    chapter: 4, kind: 'note', date: '22.02.1963',
    place: 'Object 7: the barracks, under a mattress',
    author: 'Private N. Gusev',
    title: { ru: 'Письмо рядового Гусева', en: 'Private Gusev\'s letter' },
    body: {
      ru: txt`
        Здравствуй, мама!

        С приветом к тебе твой сын Коля. Завтра праздник, День Советской Армии, у нас будет торжественное построение и кино. Служба идёт нормально, кормят хорошо, ты не волнуйся.

        Мама, это я написал, как положено. А теперь напишу как есть, потому что этого письма всё равно никто не прочтёт: письма отсюда не уходят с декабря.
        Тут холодно так, как не бывает. Солнца нет. Мы живём под землёй, подо льдом, и я забыл, какой на улице ветер.
        У нас в казарме по ночам кто-то зовёт ребят. Каждого — голосом его родных. Меня зовут твоим голосом, мама: «Коленька, иди домой». Я знаю, что это не ты. Митька Серов из Калуги в январе пошёл на голос, и больше его никто не видел. То есть видели. Лучше бы не видели.
        Если меня найдут, пусть кто-нибудь отправит это письмо. Кострома, улица Советская, дом 14, Гусевой Анне Петровне.

        Твой сын Коля.
        22 февраля 1963 г.
      `,
      en: txt`
        Hello, Mum!

        Greetings from your son Kolya. Tomorrow is a holiday, Soviet Army Day, and we'll have a parade and a film. Service is going fine, the food is good, don't you worry.

        Mum, that's what I wrote the way you're supposed to. Now I'll write the way it is, because nobody will read this letter anyway: no letters have gone out of here since December.
        It's colder here than cold can be. There's no sun. We live underground, under the ice, and I've forgotten what the wind outside is like.
        At night in our barracks someone calls the lads. Each one in the voice of his own family. Me, they call in your voice, Mum: "Kolenka, come home." I know it isn't you. Mitka Serov from Kaluga went after the voice in January, and nobody saw him again. That is, they did see him. It would have been better if they hadn't.
        If they find me, let somebody post this letter. Kostroma, Sovetskaya Street, house 14, to Anna Petrovna Guseva.

        Your son Kolya.
        22 February 1963.
      `,
    },
  },

  ch4_archive_card: {
    chapter: 4, kind: 'report', date: '14.03.1963',
    place: 'Object 7: the archive, the card index drawer',
    author: 'Captain Lykov, head of the secret section',
    title: { ru: 'Карточка учёта дела «Гость»', en: 'Index card: the file on the Guest' },
    body: {
      ru: txt`
        КАРТОЧКА УЧЁТА ДЕЛА

        Фонд 7. Опись 1. Дело № 63/7-Г.
        Заголовок: «Объект „Гость“. Материалы исследования и переписка».
        Гриф: сов. секретно, особой важности.
        Начато: 17.05.1962. Окончено: 14.03.1963. Листов: 214.
        Срок хранения: постоянно. Выдаче не подлежит.

        Приложения, хранящиеся отдельно:
        — магнитофонная запись обращения начальника объекта, катушка № 1 — кабинет начальника объекта, у магнитофона;
        — машинка подрывная КПМ-1, инв. № 7/63 — сейф начальника объекта;
        — схема полости сектора «Г» с несущими колоннами — кабинет начальника объекта.

        Опись заверил: начальник секретной части капитан Лыков
      `,
      en: txt`
        FILE INDEX CARD

        Collection 7. Inventory 1. File No. 63/7-G.
        Title: "The object called the Guest. Research materials and correspondence."
        Classification: top secret, of special importance.
        Opened: 17.05.1962. Closed: 14.03.1963. Sheets: 214.
        Retention: permanent. Not to be issued.

        Attachments kept separately:
        - tape recording of the commandant's address, reel No. 1: the commandant's office, by the tape recorder;
        - blasting machine KPM-1, inventory No. 7/63: the commandant's safe;
        - plan of the Sector G cavity with its load-bearing pillars: the commandant's office.

        Certified: Captain Lykov, head of the secret section
      `,
    },
  },

  ch4_zubov_note: {
    chapter: 4, kind: 'note', date: '09.02.1963',
    place: 'Object 7: the reactor hall, tucked into the switchboard frame',
    author: 'Senior technician Zubov, duty electrician',
    title: { ru: 'Записка дежурного электрика', en: 'The duty electrician\'s note' },
    body: {
      ru: txt`
        Для себя и для сменщика.

        Инструкция инструкцией, а защита на этом щите дурная. Если ворота сектора «Г» обесточены и надо их открыть, включай так:
        сначала ВТОРОЙ автомат (насосы охлаждения),
        потом ПЕРВЫЙ (главная шина),
        и только потом ТРЕТИЙ (гермоворота).
        Включишь шину раньше насосов — защита выбьет всё, и сиди потом в темноте, пока она взведётся.
        Проверено на своей шкуре.

        Ст. техник Зубов, 9.02.63

        P. S. Если в темноте с тобой заговорят моим голосом — это не я. Я в темноте молчу.
      `,
      en: txt`
        For me and for whoever relieves me.

        Instructions are all very well, but the protection on this board is daft. If the Sector G doors have no power and you need to open them, close the breakers like this:
        the SECOND breaker first (the cooling pumps),
        then the FIRST (the main bus),
        and only then the THIRD (the blast doors).
        Close the bus before the pumps and the protection trips the lot, and you sit in the dark until it resets.
        I learned that the hard way.

        Senior technician Zubov, 9.02.63

        P.S. If someone talks to you in the dark in my voice, it isn't me. In the dark, I keep quiet.
      `,
    },
  },

  ch4_order_63: {
    chapter: 4, kind: 'report', date: '14.03.1963',
    place: 'Object 7: the commandant\'s office, on the desk',
    author: 'Colonel A. V. Sokolov, commandant',
    title: { ru: 'Приказ № 63 о консервации объекта', en: 'Order No. 63: sealing the facility' },
    body: {
      ru: txt`
        СОВ. СЕКРЕТНО
        ПРИКАЗ начальника Объекта-7 № 63
        14 марта 1963 г.
        О консервации объекта

        Во исполнение радиограммы от 19.01.1963 об уничтожении объекта «Гость» докладываю: задача не выполнена. Сапёрное отделение лейтенанта Кравца (7 чел.) 11.03 из сектора «Г» не вернулось. Термитные заряды на колонны полости не установлены.

        ПРИКАЗЫВАЮ:
        1. Объект законсервировать. Гермоворота сектора «Г» и гермоворота портала закрыть и обесточить.
        2. Личному составу гарнизона (112 чел.) оставаться на объекте. Выход на поверхность запрещаю.
        3. Вентиляционные шахты № 1–3 заглушить бетонными плитами.
        4. Машинку подрывную КПМ-1 убрать в сейф начальника объекта.
        5. Документы по теме «Анабиоз» сдать в архив и опечатать.
        6. После передачи настоящего приказа связь с Большой землёй прекратить.

        Тем, кто придёт после нас. Мы не справились. Справьтесь вы.

        Начальник Объекта-7
        полковник А. Соколов
      `,
      en: txt`
        TOP SECRET
        ORDER No. 63 of the commandant of Object 7
        14 March 1963
        On sealing the facility

        In pursuance of the radiogram of 19.01.1963 on the destruction of the object called the Guest, I report: the task has not been carried out. Lieutenant Kravets's sapper section (7 men) did not return from Sector G on 11.03. The thermite charges have not been set on the cavity's pillars.

        I ORDER:
        1. The facility is to be sealed. The blast doors of Sector G and of the portal are to be shut and their power cut.
        2. The personnel of the garrison (112 men) are to remain in the facility. I forbid anyone to go up to the surface.
        3. Ventilation shafts Nos. 1 to 3 are to be capped with concrete slabs.
        4. The KPM-1 blasting machine is to be placed in the commandant's safe.
        5. The Anabiosis papers are to be handed in to the archive and sealed.
        6. Once this order has been transmitted, contact with the mainland is to cease.

        To those who come after us. We did not manage it. You must.

        Commandant, Object 7
        Colonel A. Sokolov
      `,
    },
  },

  // =========================================================================================
  // 5. ДОМОЙ: the tug again
  // =========================================================================================

  ch5_captain_last: {
    chapter: 5, kind: 'journal', date: '21–22.12.1990',
    place: 'Polyarnik: the bridge, the diary open on the chart table',
    author: 'Captain V. S. Volkov',
    title: { ru: 'Последняя запись капитана', en: 'The captain\'s last entry' },
    body: {
      ru: txt`
        21 декабря.
        14:10. Второй ушёл на берег с Орловым, Беловым и боцманом. Ахметов и Смирнов у трапа.
        17:30. Боцман вернулся один. Говорит: на станции темно, двери заколочены изнутри, Орлов пошёл на купол.
        19:00. На льду у борта стоят люди. Восемь... десять. Стоят и смотрят на судно. Не двигаются. Пара изо рта нет. Ахметов просил разрешения стрелять. Запретил: вдруг это зимовщики.
        20:10. Говорил со вторым по радио. Жив, на станции. Слава богу. Велел возвращаться.
        21:20. Лёша говорит, что мать зовёт его со льда. Запер его в каюте.
        22:00. Слышал по радио, как я говорю со вторым. Я не говорил. Я сидел вот здесь и писал.
        23:00. Стучат по корпусу. Со всех сторон.

        22 декабря.
        02:40. Ахметова у трапа нет. Смирнов говорит, Ахметов ушёл на лёд за кем-то, кто звал его по-татарски.
        03:15. Погас свет. Кузнецов пошёл в машинное и не вернулся. Семёныч стоит у плиты и мешает пустую кастрюлю.
        03:30. Стучат в дверь рубки. Голосом второго помощника: «Капитан, откройте, это Никитин».

        Андрей, если это читаешь ты — нас не жди. Заводи сам: воздух, топливо, пуск. Отдавай концы и уводи судно. И не веди их домой.
      `,
      en: txt`
        21 December.
        14:10. The second mate went ashore with Orlov, Belov and the bosun. Akhmetov and Smirnov at the gangway.
        17:30. The bosun came back alone. He says the station is dark, the doors nailed shut from inside, and Orlov has gone up the ice cap.
        19:00. People standing on the ice by the ship. Eight... ten. Standing and watching the ship. Not moving. No steam from their mouths. Akhmetov asked permission to fire. I refused: what if they're the winterers.
        20:10. Spoke to the second mate by radio. Alive, at the station. Thank God. Told him to come back.
        21:20. Lyosha says his mother is calling him from the ice. Locked him in his cabin.
        22:00. Heard myself on the radio, talking to the second mate. I didn't say it. I was sitting right here, writing.
        23:00. Knocking on the hull. From every side.

        22 December.
        02:40. Akhmetov is gone from the gangway. Smirnov says Akhmetov walked out onto the ice after someone who was calling him in Tatar.
        03:15. The lights went out. Kuznetsov went down to the engine room and didn't come back. Semyonych is standing at the stove, stirring an empty pot.
        03:30. Knocking on the wheelhouse door. In the second mate's voice: "Captain, open up, it's Nikitin."

        Andrei, if it's you reading this, don't wait for us. Start her yourself: air, fuel, start. Cast off the lines and take her out. And don't lead them home.
      `,
    },
  },

  ch5_engine_scrawl: {
    chapter: 5, kind: 'note', date: '22.12.1990',
    place: 'Polyarnik: the engine room, chalked on the diesel casing',
    author: 'Chief Engineer Kuznetsov',
    title: { ru: 'Мелом на дизеле', en: 'Chalked on the diesel' },
    body: {
      ru: txt`
        ВТОРОЙ!
        ПУСК:
        1. ВОЗДУХ — баллоны, оба вентиля открыть до упора.
        2. ТОПЛИВО — кран у фильтра.
        3. ПУСК — кнопка, держать, пока не схватит.
        Я НЕ УСПЕЛ. ОНИ НА ТРАПЕ.
        К.
      `,
      en: txt`
        SECOND!
        TO START:
        1. AIR: the bottles, open both valves all the way.
        2. FUEL: the cock by the filter.
        3. START: the button, hold it until she catches.
        I DIDN'T MAKE IT. THEY'RE ON THE LADDER.
        K.
      `,
    },
  },

  ch5_lyosha_scrawl: {
    chapter: 5, kind: 'note', date: '22.12.1990',
    place: 'Polyarnik: the crew quarters, scratched inside a locker door',
    author: 'Lyosha',
    title: { ru: 'Нацарапано в шкафчике', en: 'Scratched inside a locker' },
    body: {
      ru: txt`
        Я в шкафчике. Капитан меня запер, потом открыл. Нет. Это был не капитан.
        Они ходят по коридору и разговаривают нашими голосами. Друг с другом. Как будто репетируют.
        Семёныч у плиты. Боцман на льду, у кнехта.
        Мама, я слышу тебя на палубе.
        Я не выйду. Я не выйду. Я не
      `,
      en: txt`
        I'm in the locker. The captain locked me in, then let me out. No. That wasn't the captain.
        They walk up and down the passage talking in our voices. To each other. As if they were rehearsing.
        Semyonych is at the stove. The bosun's on the ice, by the bollard.
        Mum, I can hear you on deck.
        I won't come out. I won't come out. I won't
      `,
    },
  },

  ch5_mess_scrawl: {
    chapter: 5, kind: 'note', date: '22.12.1990',
    place: 'Polyarnik: the mess, carved into the table',
    author: 'Unknown',
    title: { ru: 'Вырезано на столе', en: 'Carved into the table' },
    body: {
      ru: txt`
        НЕ ОТВЕЧАЙ ИМ.
        ПОКА МОЛЧИШЬ — ОНИ НЕ ЗНАЮТ, ГДЕ ТЫ.
      `,
      en: txt`
        DON'T ANSWER THEM.
        AS LONG AS YOU KEEP QUIET, THEY DON'T KNOW WHERE YOU ARE.
      `,
    },
  },
};

// the ids of each chapter's documents, in the order above
export const DOCS_BY_CHAPTER = Object.entries(DOCUMENTS).reduce((by, [id, d]) => ((by[d.chapter] ||= []).push(id), by), {});
