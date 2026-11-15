/**
 * The starting catalog: attributes, skills, measurements, templates, quests,
 * medals and achievements. All of it is editable in the app. None of it is
 * sample data: it's the real configuration Ryu starts with.
 */
import type { QuestInput } from "@/validation/schemas";

export const ATTRIBUTES = [
  { id: "academics", name: "Academics", icon: "graduation-cap", color: "#7c9cff" },
  { id: "athletics", name: "Athletics", icon: "activity", color: "#5fcf9f" },
  { id: "creative", name: "Creative", icon: "music", color: "#e0a458" },
  { id: "personal-development", name: "Personal Development", icon: "compass", color: "#c48fd9" },
  { id: "engineering", name: "Engineering", icon: "cpu", color: "#5ec4d6" },
];

interface SkillDef {
  id: string;
  name: string;
  attributeId: string;
  parentId?: string;
  kind?: "skill" | "trait";
  aliases?: string[];
  model?: "primary" | "weighted";
  primary?: string;
}

export const ACADEMIC_SKILLS = [
  ["mathematics", "Mathematics", ["maths", "math"]],
  ["further-mathematics", "Further Mathematics", ["further maths", "fm", "further math"]],
  ["physics", "Physics", ["phys"]],
  ["chemistry", "Chemistry", ["chem"]],
  ["biology", "Biology", ["bio"]],
  ["economics", "Economics", ["econ"]],
  ["computer-science", "Computer Science", ["cs", "comp sci", "compsci"]],
  ["geography", "Geography", ["geo"]],
  ["english", "English", ["eng", "english lit", "english language"]],
  ["thai", "Thai", ["thai studies"]],
  ["design-technology", "Design Technology", ["dt", "d&t", "design tech"]],
] as const;

export const SKILLS: SkillDef[] = [
  ...ACADEMIC_SKILLS.map(([id, name, aliases]) => ({
    id,
    name,
    attributeId: "academics",
    aliases: [...aliases],
    model: id === "english" ? ("weighted" as const) : ("primary" as const),
    primary: id === "english" ? undefined : `${id}-gcse`,
  })),
  { id: "tennis", name: "Tennis", attributeId: "athletics", primary: "tennis-rubric" },
  { id: "swimming", name: "Swimming", attributeId: "athletics", aliases: ["swim"], primary: "swim-50-free" },
  { id: "track", name: "Track", attributeId: "athletics", aliases: ["running", "run", "sprint", "sprints"], primary: "track-100m" },
  { id: "gym", name: "Gym", attributeId: "athletics", aliases: ["workout", "weights", "lifting"], primary: "gym-pushups" },
  { id: "volleyball", name: "Volleyball", attributeId: "athletics", aliases: ["vball", "volley"], primary: "volleyball-rubric" },
  { id: "piano", name: "Piano", attributeId: "creative", primary: "piano-abrsm" },
  { id: "music-theory", name: "Music Theory", attributeId: "creative", parentId: "piano", aliases: ["theory"], primary: "theory-abrsm" },
  { id: "discipline", name: "Discipline", attributeId: "personal-development", kind: "trait" },
  { id: "consistency", name: "Consistency", attributeId: "personal-development", kind: "trait" },
  { id: "time_management", name: "Time Management", attributeId: "personal-development", kind: "trait" },
  { id: "resilience", name: "Resilience", attributeId: "personal-development", primary: "resilience-rubric" },
  { id: "programming", name: "Programming", attributeId: "engineering", aliases: ["coding", "code"], primary: "programming-rubric" },
  { id: "robotics", name: "Robotics", attributeId: "engineering", aliases: ["vex", "robot", "robot build"], primary: "robotics-rubric" },
];

export const ACTIVITY_TYPES = [
  ["practice", "Practice"],
  ["study", "Study"],
  ["training", "Training"],
  ["lesson", "Lesson"],
  ["project", "Project work"],
  ["competition", "Competition"],
  ["exam", "Exam or assessment"],
  ["light", "Light (reading, tutorials)"],
] as const;

const GCSE = ["9", "8", "7", "6", "5", "4", "3", "2", "1"].map((label, i) => ({ label, score: [95, 88, 80, 72, 64, 56, 45, 30, 15][i]! }));
const ABRSM = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((g) => [
    { label: `Grade ${g} Pass`, score: g * 10 },
    { label: `Grade ${g} Merit`, score: g * 10 + 3 },
    { label: `Grade ${g} Distinction`, score: g * 10 + 6 },
  ]),
  { label: "ARSM", score: 90 },
  { label: "DipABRSM", score: 100 },
];
export const RUBRIC = ["Beginner", "Developing", "Competent", "Advanced", "Expert"].map((label, i) => ({ label, score: i * 25 }));

interface MeasurementDef {
  id: string;
  skillId: string;
  name: string;
  valueKind: "number" | "time" | "percent" | "grade";
  unit?: string;
  direction: "higher" | "lower";
  anchorLow?: number;
  anchorHigh?: number;
  gradeScale?: { label: string; score: number }[];
  weight: number;
}

export const MEASUREMENTS: MeasurementDef[] = [
  ...ACADEMIC_SKILLS.flatMap(([id, name]): MeasurementDef[] => {
    const exam: MeasurementDef = { id: `${id}-exam`, skillId: id, name: `${name} test percentage`, valueKind: "percent", unit: "%", direction: "higher", anchorLow: 0, anchorHigh: 100, weight: 0 };
    if (id === "english") {
      return [
        { id: "english-language-gcse", skillId: id, name: "English Language reporting grade", valueKind: "grade", direction: "higher", gradeScale: GCSE, weight: 1 },
        { id: "english-literature-gcse", skillId: id, name: "English Literature reporting grade", valueKind: "grade", direction: "higher", gradeScale: GCSE, weight: 1 },
        exam,
      ];
    }
    return [{ id: `${id}-gcse`, skillId: id, name: "GCSE reporting grade", valueKind: "grade", direction: "higher", gradeScale: GCSE, weight: 1 }, exam];
  }),
  { id: "piano-abrsm", skillId: "piano", name: "ABRSM performance grade", valueKind: "grade", direction: "higher", gradeScale: ABRSM, weight: 1 },
  { id: "theory-abrsm", skillId: "music-theory", name: "ABRSM theory grade", valueKind: "grade", direction: "higher", gradeScale: ABRSM, weight: 1 },
  { id: "swim-50-free", skillId: "swimming", name: "50 m freestyle", valueKind: "time", unit: "s", direction: "lower", anchorLow: 60, anchorHigh: 25, weight: 1 },
  { id: "track-100m", skillId: "track", name: "100 m sprint", valueKind: "time", unit: "s", direction: "lower", anchorLow: 18, anchorHigh: 10.5, weight: 1 },
  { id: "gym-pushups", skillId: "gym", name: "Most push-ups in one set", valueKind: "number", unit: "reps", direction: "higher", anchorLow: 0, anchorHigh: 60, weight: 1 },
  ...["tennis", "volleyball", "programming", "robotics", "resilience"].map((id) => ({
    id: `${id}-rubric`,
    skillId: id,
    name: "Level (rubric)",
    valueKind: "grade" as const,
    direction: "higher" as const,
    gradeScale: RUBRIC,
    weight: 1,
  })),
];

export const TEMPLATES = [
  { id: "tpl-piano", name: "Piano practice", aliases: ["piano"], activityTypeId: "practice", difficulty: "normal", durationMin: 20, skills: [{ skillId: "piano", weight: 100 }], pinned: true },
  { id: "tpl-maths", name: "Maths revision", aliases: ["maths revision"], activityTypeId: "study", difficulty: "normal", durationMin: 45, skills: [{ skillId: "mathematics", weight: 100 }], pinned: true },
  { id: "tpl-further-maths", name: "Further Maths revision", aliases: [], activityTypeId: "study", difficulty: "normal", durationMin: 45, skills: [{ skillId: "further-mathematics", weight: 100 }], pinned: false },
  { id: "tpl-physics", name: "Physics revision", aliases: [], activityTypeId: "study", difficulty: "normal", durationMin: 45, skills: [{ skillId: "physics", weight: 100 }], pinned: false },
  { id: "tpl-chemistry", name: "Chemistry revision", aliases: [], activityTypeId: "study", difficulty: "normal", durationMin: 45, skills: [{ skillId: "chemistry", weight: 100 }], pinned: false },
  { id: "tpl-gym", name: "Gym session", aliases: ["gym"], activityTypeId: "training", difficulty: "normal", durationMin: 45, skills: [{ skillId: "gym", weight: 100 }], pinned: true },
  { id: "tpl-track", name: "Track training", aliases: ["track"], activityTypeId: "training", difficulty: "hard", durationMin: 60, skills: [{ skillId: "track", weight: 100 }], pinned: false },
  { id: "tpl-swim", name: "Swim session", aliases: ["swim"], activityTypeId: "training", difficulty: "normal", durationMin: 45, skills: [{ skillId: "swimming", weight: 100 }], pinned: false },
  { id: "tpl-volleyball", name: "Volleyball practice", aliases: ["volleyball"], activityTypeId: "training", difficulty: "normal", durationMin: 60, skills: [{ skillId: "volleyball", weight: 100 }], pinned: true },
  { id: "tpl-tennis", name: "Tennis", aliases: ["tennis"], activityTypeId: "training", difficulty: "normal", durationMin: 60, skills: [{ skillId: "tennis", weight: 100 }], pinned: false },
  { id: "tpl-robotics", name: "Robotics build", aliases: ["robotics", "vex"], activityTypeId: "project", difficulty: "normal", durationMin: 90, skills: [{ skillId: "robotics", weight: 70 }, { skillId: "programming", weight: 30 }], pinned: true },
  { id: "tpl-programming", name: "Programming", aliases: ["coding"], activityTypeId: "project", difficulty: "normal", durationMin: 60, skills: [{ skillId: "programming", weight: 100 }], pinned: false },
  { id: "tpl-theory", name: "Music theory", aliases: ["theory"], activityTypeId: "study", difficulty: "normal", durationMin: 20, skills: [{ skillId: "music-theory", weight: 100 }], pinned: false },
];

const academics = ACADEMIC_SKILLS.map(([id]) => id as string);
const athletics = ["tennis", "swimming", "track", "gym", "volleyball"];
const bkkDate = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - 7 * 3_600_000;

export const QUESTS: QuestInput[] = [
  {
    id: "daily-piano",
    title: "Practice piano for 20 minutes",
    kind: "daily",
    skills: [{ skillId: "piano", weight: 100 }],
    requirements: [{ type: "duration", target: 20, filter: { skillIds: ["piano"] } }],
  },
  {
    id: "daily-study",
    title: "Study for 60 minutes",
    kind: "daily",
    requirements: [{ type: "duration", target: 60, filter: { skillIds: academics } }],
  },
  {
    id: "weekly-piano",
    title: "Weekly piano: 120 minutes",
    kind: "weekly",
    skills: [{ skillId: "piano", weight: 100 }],
    requirements: [{ type: "duration", target: 120, filter: { skillIds: ["piano"] } }],
  },
  {
    id: "weekly-exercise",
    title: "Exercise 4 times this week",
    kind: "weekly",
    requirements: [{ type: "sessions", target: 4, filter: { skillIds: athletics, minSessionMinutes: 30 } }],
  },
  {
    id: "weekly-revision",
    title: "Five hours of revision",
    kind: "weekly",
    requirements: [{ type: "duration", target: 300, filter: { skillIds: academics } }],
  },
  {
    id: "abrsm-grade-7",
    title: "ABRSM Piano Grade 7",
    description: "Pass Grade 7 piano. Passing with Distinction would raise Piano to a B.",
    kind: "long_term",
    difficulty: "hard",
    rewardXp: 500,
    skills: [{ skillId: "piano", weight: 100 }],
    requirements: [
      { id: "register", type: "milestone", title: "Register for the Grade 7 exam", target: 1 },
      { id: "pass", type: "assessment", title: "Pass Grade 7 (record the result)", target: 70, measurementTypeId: "piano-abrsm" },
    ],
  },
  {
    id: "abrsm-grade-7-weekly",
    title: "Grade 7 practice: 150 minutes",
    description: "Supporting quest for ABRSM Grade 7: repertoire, technique and sight-reading.",
    kind: "weekly",
    parentQuestId: "abrsm-grade-7",
    origin: "generated",
    skills: [{ skillId: "piano", weight: 100 }],
    requirements: [{ type: "duration", target: 150, filter: { skillIds: ["piano"] } }],
  },
  {
    id: "varsity-track",
    title: "Make varsity: Track",
    kind: "long_term",
    difficulty: "hard",
    rewardXp: 500,
    skills: [{ skillId: "track", weight: 100 }],
    requirements: [{ id: "selected", type: "milestone", title: "Selected for the varsity track team", target: 1 }],
  },
  {
    id: "volleyball-second-team",
    title: "Make the volleyball second team",
    description: "Starting from Beginner. Aim for Competent by tryouts.",
    kind: "long_term",
    difficulty: "very_hard",
    rewardXp: 500,
    endAt: bkkDate(2027, 9, 1),
    skills: [{ skillId: "volleyball", weight: 100 }],
    requirements: [
      { id: "competent", type: "assessment", title: "Reach Competent (monthly self-rating)", target: 50, measurementTypeId: "volleyball-rubric" },
      { id: "selected", type: "milestone", title: "Selected for the second team", target: 1 },
    ],
  },
  {
    id: "volleyball-weekly",
    title: "Volleyball: 3 sessions of 45+ minutes",
    description: "Supporting quest for making the second team.",
    kind: "weekly",
    parentQuestId: "volleyball-second-team",
    origin: "generated",
    skills: [{ skillId: "volleyball", weight: 100 }],
    requirements: [{ type: "sessions", target: 3, filter: { skillIds: ["volleyball"], minSessionMinutes: 45 } }],
  },
  {
    id: "vex-nationals-2027",
    title: "Thailand VEX V5 National Championship (High School)",
    description: "21-22 January 2027, Central Chaengwattana.",
    kind: "long_term",
    difficulty: "hard",
    rewardXp: 300,
    endAt: bkkDate(2027, 1, 23),
    skills: [{ skillId: "robotics", weight: 70 }, { skillId: "programming", weight: 30 }],
    requirements: [
      { id: "notebook", type: "milestone", title: "Engineering notebook submitted", target: 1 },
      { id: "compete", type: "milestone", title: "Competed at nationals", target: 1 },
    ],
  },
];

export const MEDALS = [
  { id: "abrsm-grade", name: "ABRSM Grade", tier: "silver", repeatable: true, awardRule: "manual", skills: [{ skillId: "piano", weight: 100 }] },
  { id: "abrsm-piano-grade-7", name: "ABRSM Piano Grade 7", tier: "silver", repeatable: false, awardRule: "quest", linkedQuestId: "abrsm-grade-7", skills: [{ skillId: "piano", weight: 100 }] },
  { id: "vex-award", name: "VEX Award", tier: "bronze", repeatable: true, awardRule: "manual", skills: [{ skillId: "robotics", weight: 100 }] },
  { id: "vex-worlds", name: "VEX World Championship Qualification", tier: "gold", repeatable: true, awardRule: "manual", skills: [{ skillId: "robotics", weight: 100 }] },
  { id: "perfect-term", name: "Perfect Term", tier: "bronze", repeatable: true, awardRule: "manual", skills: "academics" }, // split equally across Academics
  { id: "ukmt", name: "UKMT Mathematical Challenge", tier: "silver", repeatable: true, awardRule: "manual", skills: [{ skillId: "mathematics", weight: 100 }] },
  { id: "school-team", name: "School Team Selection", tier: "silver", repeatable: true, awardRule: "manual", skills: [] },
  { id: "varsity-track", name: "Varsity: Track", tier: "silver", repeatable: false, awardRule: "quest", linkedQuestId: "varsity-track", skills: [{ skillId: "track", weight: 100 }] },
  { id: "volleyball-second-team", name: "Volleyball Second Team", tier: "bronze", repeatable: false, awardRule: "quest", linkedQuestId: "volleyball-second-team", skills: [{ skillId: "volleyball", weight: 100 }] },
  { id: "competition-award", name: "Competition Award", tier: "bronze", repeatable: true, awardRule: "manual", skills: [] },
] as const;

export const ACHIEVEMENTS = [
  { id: "first-activity", name: "First Steps", description: "Log your first activity.", icon: "footprints", conditionType: "activity_count", params: { count: 1 } },
  { id: "first-quest", name: "Quest Complete", description: "Complete your first quest.", icon: "flag", conditionType: "quest_completions", params: { count: 1 } },
  { id: "piano-10h", name: "10 Hours of Piano", description: "Practice piano for 10 hours in total.", icon: "music", conditionType: "total_minutes", params: { minutes: 600, skillId: "piano" } },
  { id: "exercise-100h", name: "100 Hours of Exercise", description: "Train for 100 hours across Athletics.", icon: "activity", conditionType: "total_minutes", params: { minutes: 6000, attributeId: "athletics" } },
  { id: "first-competition", name: "Game Day", description: "Log your first competition.", icon: "swords", conditionType: "activity_count", params: { count: 1, activityTypeId: "competition" } },
  { id: "streak-7", name: "One Full Week", description: "Keep a 7-day streak.", icon: "flame", conditionType: "streak", params: { days: 7 } },
  { id: "streak-30", name: "30-Day Consistency", description: "Keep a 30-day streak (rest days allowed).", icon: "flame", conditionType: "streak", params: { days: 30 } },
  { id: "level-15", name: "Level 15", description: "Reach character level 15.", icon: "star", conditionType: "level", params: { level: 15 } },
  { id: "gold-3", name: "Gold Standard", description: "Earn three Gold medals.", icon: "medal", conditionType: "medal_count", params: { count: 3, tier: "gold" } },
  { id: "hidden-100", name: "Centurion", description: "Log 100 activities.", icon: "shield", hidden: true, conditionType: "activity_count", params: { count: 100 } },
  { id: "hidden-medals-20", name: "Trophy Cabinet", description: "Earn 20 medals.", icon: "trophy", hidden: true, conditionType: "medal_count", params: { count: 20 } },
];
