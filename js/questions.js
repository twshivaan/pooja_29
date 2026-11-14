/*
 * Every section, question, option and line of copy for the birthday surprise.
 * app.js reads this as data and stays generic.
 *
 * Question types: short, long, single, multi, scale5, three, unlock.
 * `when(a)` decides visibility from the answers so far (sections, screens, questions, options).
 * Stored values are the option `v`; emoji are for display only.
 */
const P = CONFIG.PERSON_NAME;

const COPY = {
  welcomeText: `Help us make her birthday unforgettable! Takes about 10–15 minutes. Questions marked * are required, baaki sab optional. And shh, ${P} ko kuch mat batana 🤫`,
  welcomeButton: "Chalo, let's go →",
  deadline: (label) => `Last date: ${label}`,
  resumeQ: "Continue where you left off?",
  resumeYes: "Haan, continue →",
  resumeNo: "Start fresh",
  incomplete: "This link is incomplete. Ask for the full link again 🙏",
  closed: "This surprise is now closed. Thank you! 🎉",
  next: "Next",
  back: "Back",
  submit: "Submit 🎉",
  sectionLabel: (n) => `Section ${n}`,
  counter: (n, total) => `${n} of ${total}`,
  sending: "Sending your answers…",
  sendingPhotos: (n) => `Uploading ${n} photo${n === 1 ? "" : "s"}…`,
  sendFail: "Couldn't send that. Check your internet and try again.",
  photoFail: (n) => `${n} photo${n === 1 ? "" : "s"} didn't upload yet.`,
  finishWithout: "Finish without them",
  tryAgain: "Try again",
  thanks: (count) => count
    ? `Done! You're #${count} to join the surprise 🎉 ${P} ko kuch mat batana 🤫`
    : `Done! You've joined the surprise 🎉 ${P} ko kuch mat batana 🤫`,
  share: "Share on WhatsApp",
  shareText: (label, link) => label
    ? `${P}'s birthday surprise 🎂 Takes 10–15 min, fill it before ${label}: ${link}`
    : `${P}'s birthday surprise 🎂 Takes 10–15 min, fill it soon: ${link}`,
  addAnother: "Add another response",
  status: { saving: "Saving…", saved: "Saved ✓", retry: "Will retry" },
  scale: ["Never 😇", "Rarely 🙂", "Sometimes 😏", "Usually 😂", "Every. Single. Time 💀"],
  everIntro: `Has ${P} ever…`,
  everButtons: [
    { v: "yes", label: "Yes" },
    { v: "no", label: "No" },
    { v: "no_comment", label: "No comment 🤐" },
  ],
  everReactions: {
    yes: ["Obviously 😂", "Knew it 👀", `Classic ${P}`],
    no: ["Haan haan, sure 👀", "So innocent 😇"],
    no_comment: ["Suspicious… 🤐"],
  },
  everSkip: "Skip",
  everDone: (n) => `That's all ${n}! 🙌`,
  everDoneSub: "Tap Next to keep going.",
  unlockText: "Unlock the spicy section? Friends only 🌶️",
  unlockWork: "Optional. Skip it if you're her boss 😅",
  unlockYes: "Haan, I'm in 🌶️",
  unlockNo: "Skip",
  secretStamp: "Secret page · friends only",
  picked: (n, max) => `${n}/${max} picked`,
  otherPlaceholder: "Type it here",
  emojiOther: "Other emoji or word",
  lieStamp: "LIE 🤥",
  photo: {
    add: "Add photo",
    caption: "Caption (optional)",
    remove: "Remove photo",
    waiting: "Waiting…",
    processing: "Getting it ready…",
    uploading: "Uploading…",
    done: "Uploaded ✓",
    retry: "Will retry",
    full: (max) => `That's the max ${max} here 🙂`,
    totalFull: (max) => `That's ${max} photos in total, the max 🙂`,
    unreadable: "Couldn't read this photo. Try a screenshot or another one.",
    tooBig: "This photo is too big. Try a screenshot or another one.",
    rejected: "This one couldn't be added. Try another photo.",
  },
};

const RELATIONS = [
  { v: "School", e: "🎒" },
  { v: "College", e: "🎓" },
  { v: "Work", e: "💼" },
  { v: "Family", e: "🏠" },
  { v: "Other", e: "✨" },
];

const isFamily = (a) => a.relation === "Family";
const canUnlock = (a) => !!a.relation && a.relation !== "Family";
const spicyOn = (a) => canUnlock(a) && a.spicy_unlocked === "yes";

const SECTIONS = [
  {
    id: "about",
    emoji: "👋",
    title: "About you",
    intro: "Pehle batao, who's this? 👀",
    screens: [
      {
        id: "name",
        questions: [
          { id: "name", type: "short", label: "Your name", required: true, autocomplete: "name", maxLength: 80 },
        ],
      },
      {
        id: "relation",
        questions: [
          { id: "relation", type: "single", style: "cards", label: `How do you know ${P}?`, required: true, options: RELATIONS },
        ],
      },
      {
        id: "family",
        heading: "🏠 Family special",
        when: (a) => a.relation === "Family",
        questions: [
          { id: "family_kid", type: "long", label: "What was she like as a kid?" },
          { id: "family_dream", type: "short", label: "What did she want to be when she grew up?" },
        ],
      },
      {
        id: "school",
        heading: "🎒 School days",
        when: (a) => a.relation === "School",
        questions: [
          { id: "school_3words", type: "three", label: `School-${P} in 3 words` },
          {
            id: "school_type", type: "single", style: "list", label: "In school, she was the…",
            options: [
              { v: "Topper", e: "🏆" },
              { v: "Backbencher", e: "🪑" },
              { v: "Teacher's pet", e: "🍎" },
              { v: "Bunk planner", e: "🏃‍♀️" },
              { v: "Class monitor", e: "📋" },
            ],
          },
        ],
      },
      {
        id: "college",
        heading: "🎓 College days",
        when: (a) => a.relation === "College",
        questions: [
          { id: "college_hostel_moment", type: "long", label: "Her most iconic hostel moment" },
          { id: "college_snack", type: "short", label: "Her 2 AM hostel snack" },
        ],
      },
      {
        id: "work",
        heading: "💼 Work mode",
        when: (a) => a.relation === "Work",
        questions: [
          { id: "work_meeting_line", type: "short", label: "Her most-used line in meetings" },
        ],
      },
      {
        id: "known",
        questions: [
          {
            id: "known_for", type: "single", style: "list", label: "How long have you known her?",
            options: [
              { v: "Under 1 year" },
              { v: "1–3 years" },
              { v: "3–5 years" },
              { v: "5–10 years" },
              { v: "Since forever" },
            ],
          },
        ],
      },
      {
        id: "met",
        questions: [
          { id: "how_met", type: "short", label: "How did you two meet?" },
          { id: "nickname", type: "short", label: "What do you call her?" },
        ],
      },
      {
        id: "unlock",
        kind: "unlock",
        when: canUnlock,
        questions: [{ id: "spicy_unlocked", type: "unlock" }],
      },
    ],
  },

  {
    id: "meter",
    emoji: "📊",
    title: `The ${P}-meter`,
    intro: "How likely is she to…",
    screens: [
      {
        id: "meter",
        heading: "How likely is she to…",
        questions: [
          { id: "meter_omw", type: "scale5", label: "Text \"on my way\" while still in bed" },
          { id: "meter_trip", type: "scale5", label: "Plan a trip and actually go" },
          { id: "meter_lost", type: "scale5", label: "Get lost even with Google Maps" },
          { id: "meter_sleep", type: "scale5", label: "Fall asleep first (sleepover, movie or meeting)" },
          { id: "meter_joke", type: "scale5", label: "Laugh at her own joke before finishing it" },
          { id: "meter_overthink", type: "scale5", label: "Overthink a text" },
          { id: "meter_argue", type: "scale5", label: "Win an argument" },
        ],
      },
    ],
  },

  {
    id: "ever",
    emoji: "👀",
    title: `Has ${P} ever…?`,
    intro: "Answer each one: Yes · No · No comment 🤐",
    screens: [
      {
        id: "stack",
        kind: "stack",
        questions: [
          { id: "ever_bunk", type: "ever", label: "Bunked a class or skipped work just for fun" },
          { id: "ever_sleep_class", type: "ever", label: "Fallen asleep in a lecture or meeting" },
          { id: "ever_insta_like", type: "ever", label: "Stalked someone's Instagram and accidentally liked an old post" },
          { id: "ever_cry_movie", type: "ever", label: "Cried over a movie" },
          { id: "ever_trouble", type: "ever", label: "Gotten into trouble with a teacher or boss" },
          { id: "ever_crush", type: "ever", label: "Had a crush on a teacher, celebrity or fictional character" },
          { id: "ever_sing", type: "ever", label: "Sung loudly in public" },
          { id: "ever_vidaai", type: "ever", label: "Cried at a wedding vidaai 😭" },
          { id: "ever_sangeet", type: "ever", label: "Danced at a sangeet like it was her own wedding 💃" },
          { id: "ever_wrong_chat", type: "ever", label: "Sent a message to the wrong chat 🙈" },
          { id: "ever_mute", type: "ever", label: "Said something on a call thinking she was on mute 🎤" },
          { id: "ever_nod", type: "ever", label: "Nodded along in class or a meeting, then Googled it later 🤓" },
          { id: "ever_shopping", type: "ever", label: "Gone shopping for one thing and come back with ten 🛍️" },
          { id: "ever_auto", type: "ever", label: "Argued with an auto driver over ₹10 🛺" },
          { id: "ever_maggi", type: "ever", label: "Burnt Maggi 🔥" },
        ],
      },
    ],
  },

  {
    id: "decoded",
    emoji: "🔍",
    title: `${P}, decoded`,
    intro: "The little things that make her, her ✨",
    screens: [
      {
        id: "emoji",
        questions: [
          {
            id: "emoji", type: "single", style: "emoji", label: `${P} in one emoji`, otherKey: "emoji__other",
            options: "😂 🥰 😎 🤪 😴 🤓 😇 😈 🥹 🤭 💃 👑 🌸 🦋 ☕ 🍕 🏔️ 📚 🎧 📸 ✨ 🔥 🌈 🐼 🐱 🎀 🧿 🫶 🤯 🙈"
              .split(" ").map((e) => ({ v: e })),
          },
        ],
      },
      {
        id: "song",
        questions: [
          { id: "song", type: "short", label: "A song that's so her" },
          { id: "song_why", type: "short", label: "Why?", attach: true },
        ],
      },
      {
        id: "character",
        questions: [
          { id: "character", type: "short", label: "Which movie or series character does she remind you of?" },
          { id: "character_why", type: "short", label: "Why?", attach: true },
        ],
      },
      {
        id: "little",
        questions: [
          { id: "cafe_order", type: "short", label: "Her go-to café order" },
          { id: "bag", type: "short", label: "What's always in her bag?" },
          { id: "hidden_talent", type: "short", label: "Her hidden talent" },
        ],
      },
      {
        id: "salary",
        questions: [
          {
            id: "salary", type: "multi", style: "chips", max: 3, label: "Where does her salary go? Pick up to 3",
            otherKey: "salary__other",
            options: [
              { v: "Rent & bills", e: "🧾" },
              { v: "Savings & investments", e: "📈" },
              { v: "Family", e: "👨‍👩‍👧" },
              { v: "Food delivery & cafés", e: "🍕" },
              { v: "Travel & treks", e: "🏔️" },
              { v: "Shopping", e: "🛍️" },
              { v: "Makeup & skincare", e: "💄" },
              { v: "Gadgets", e: "📱" },
              { v: "Subscriptions (OTT, apps)", e: "📺" },
              { v: "Gifts for others", e: "🎁" },
              { v: "Dating app subscription", e: "💘", when: spicyOn },
              { v: "Protection", e: "🛡️", when: spicyOn },
              { v: "Other", other: true },
            ],
          },
        ],
      },
      {
        id: "career",
        questions: [
          {
            id: "career", type: "single", style: "chips", label: "If not engineering, which career should she have gone for?",
            otherKey: "career__other",
            options: [
              { v: "Therapist", e: "🧠" },
              { v: "Singer", e: "🎤" },
              { v: "Dancer", e: "💃" },
              { v: "Actor", e: "🎬" },
              { v: "Teacher or professor", e: "👩‍🏫" },
              { v: "Chef", e: "👩‍🍳" },
              { v: "Fashion designer", e: "👗" },
              { v: "Travel vlogger", e: "✈️" },
              { v: "Photographer", e: "📸" },
              { v: "Lawyer", e: "⚖️" },
              { v: "Doctor", e: "🩺" },
              { v: "IAS officer", e: "🏛️" },
              { v: "News anchor", e: "📰" },
              { v: "RJ", e: "📻" },
              { v: "Wedding planner", e: "💍" },
              { v: "Stand-up comedian", e: "🎙️" },
              { v: "Other", other: true },
            ],
          },
        ],
      },
    ],
  },

  {
    id: "games",
    emoji: "🔥",
    title: "Games & roasts",
    intro: "Thoda masti, thoda roast 😈",
    screens: [
      {
        id: "dict",
        cardClass: "dict",
        questions: [
          { id: "dict_word", type: "short", label: `${P} Dictionary: her word or phrase`, example: "\"Bas 5 minute\"" },
          { id: "dict_meaning", type: "short", label: "What it actually means", example: "minimum 45 minutes", attach: true },
        ],
      },
      {
        id: "roast",
        questions: [
          { id: "roast", type: "short", label: "Roast her, gently" },
          { id: "villain_origin", type: "short", label: "Her villain origin story", example: "\"Someone finished her Maggi\"" },
        ],
      },
      {
        id: "lie",
        questions: [
          {
            id: "lie_pick", type: "single", style: "lie", label: "Two truths and a lie: which one's the lie?",
            options: [
              { v: "She cancels plans at the last minute" },
              { v: "She replies" },
              { v: "She doesn't stalk profiles" },
            ],
          },
        ],
      },
      {
        id: "ask",
        questions: [
          { id: "ask_her", type: "short", label: "Ask her anything: one question you want her to answer" },
        ],
      },
    ],
  },

  {
    id: "spicy",
    emoji: "🌶️",
    title: "The spicy section",
    intro: "Friends only 🌶️ Sach bolo, no judgement.",
    variant: "spicy",
    when: spicyOn,
    screens: [
      {
        id: "movie",
        questions: [
          {
            id: "spicy_movie", type: "single", style: "posters", label: "Solo movie night: what's she actually watching?",
            options: [
              { v: "Taarak Mehta Ka Ooltah Chashmah", e: "😂" },
              { v: "Fifty Shades of Grey", e: "🔥" },
              { v: "DDLJ", e: "❤️" },
              { v: "Bigg Boss", e: "📺" },
              { v: "The Notebook", e: "😭" },
              { v: "She falls asleep", e: "😴" },
            ],
          },
        ],
      },
      {
        id: "marriage",
        questions: [
          {
            id: "spicy_marriage", type: "single", style: "list", label: "Love or arranged?",
            options: [
              { v: "Love marriage", e: "💘" },
              { v: "Arranged marriage", e: "🙏" },
              { v: "Love-cum-arranged", e: "🤝" },
              { v: "Court marriage", e: "📜" },
              { v: "Not getting married", e: "🙅‍♀️" },
            ],
          },
        ],
      },
      {
        id: "kids",
        questions: [
          {
            id: "spicy_kids_count", type: "single", style: "kids", label: "How many kids will she have?",
            options: [
              { v: "0", label: "0, just pets", e: "🐶" },
              { v: "1" },
              { v: "2" },
              { v: "3" },
              { v: "4+" },
            ],
          },
          {
            id: "spicy_kids_age", type: "single", style: "list", label: "How old will she be when she has her first?",
            attach: true,
            when: (a) => a.spicy_kids_count !== "0",
            options: [
              { v: "Before 27" },
              { v: "27–30" },
              { v: "31–35" },
              { v: "After 35" },
            ],
          },
        ],
      },
    ],
  },

  {
    id: "memories",
    emoji: "💭",
    title: "Memory lane",
    intro: "Thodi si nostalgia, please 🥹",
    screens: [
      {
        id: "fav",
        questions: [
          {
            id: "memory_fav", type: "long", label: "Your favourite memory with her",
            hints: ["That one trip when…", "The time she…", "I'll never forget when…"],
          },
        ],
      },
      {
        id: "funny",
        questions: [
          { id: "memory_funny", type: "long", label: "Your funniest or most embarrassing story about her", sub: "We'll only use it lovingly 🤞" },
        ],
      },
      {
        id: "then_now",
        cardClass: "pair",
        questions: [
          { id: "first_impression", type: "short", label: "When I met her, I thought…" },
          { id: "now_i_know", type: "short", label: "Now I know…", attach: true },
        ],
      },
    ],
  },

  {
    id: "photos",
    emoji: "📸",
    title: "Photo dump",
    intro: "Gallery kholo, it's time 📂",
    screens: [
      {
        id: "photos",
        kind: "photos",
        slots: [
          { id: "funny", label: "Funniest photo of her", sub: "Win ₹50–₹500 if she'd want it deleted 😈" },
          { id: "aesthetic", label: "Most aesthetic, beautiful or cute photo of her" },
          { id: "together", label: "Best photo of the two of you, or a group photo of your gang" },
          { id: "candid", label: "A candid she doesn't know exists" },
          { id: "childhood", label: "Childhood photo, or the oldest photo you have of her" },
        ],
        questions: [
          {
            id: "funny_upi", type: "short", label: "Your UPI ID, for the prize", sub: "Only used to send your prize.",
            afterSlot: "funny", autocomplete: "off", maxLength: 100,
            when: () => typeof Photos !== "undefined" && Photos.count("funny") > 0,
          },
        ],
      },
    ],
  },

  {
    id: "wishes",
    emoji: "🎂",
    title: "Birthday wishes",
    intro: "Last one! Dil se likho 💌",
    screens: [
      {
        id: "short",
        questions: [
          { id: "wish_short", type: "short", label: "Your birthday wish for her, in one line", required: true, maxLength: 150, counter: true },
        ],
      },
      {
        id: "letter",
        questions: [
          { id: "wish_letter", type: "long", label: "Write her a proper letter", sub: "Optional, but she'll love it 💛" },
        ],
      },
    ],
  },
];
