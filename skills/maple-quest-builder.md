---
name: "MapleStory Quest Builder"
description: "Focused guide for creating quests in Cosmic v83. Quest scripts, state tracking, rewards, dialogue chains."
keywords: ["quest", "questline", "quest chain", "storyline", "dialogue", "maple quest"]
category: "gamedev"
---

# Quest Builder — Cosmic v83

## HARD RULES

1. All quest scripts use Rhino JS — NO backticks, NO bare newlines, NO arrow functions
2. Use `cm.startQuest()`/`cm.completeQuest()` for state tracking
3. Use `cm.haveItem()` for proof items — never trust client-side checks
4. Every quest reward must be balanced for the level range
5. Multi-step quests need clear progression indicators in dialogue

## Quest Types

| Type | Purpose | Example |
|------|---------|---------|
| Talk quest | Lore/intro, just dialogue | "Talk to Elder about class history" |
| Kill quest | Combat training | "Kill 50 Skeleton Warriors" |
| Collect quest | Item gathering | "Collect 30 Dark Crystals" |
| Delivery quest | Travel between NPCs | "Bring this letter to the 2nd instructor" |
| Trial quest | Boss fight / challenge | "Defeat your Dark Clone" |
| Chain quest | Multi-step storyline | Combines above types in sequence |

## Quest Script Template — Simple Kill/Collect

**Start NPC script** (`scripts/npc/{NPC_ID}.js`):
```javascript
var status = 0;
var QUEST_ID = 29000; // pick unused quest ID

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        // Check if quest already completed
        if (cm.isQuestCompleted(QUEST_ID)) {
            cm.sendOk("You have already completed this task. Well done!");
            cm.dispose();
            return;
        }
        // Check if quest in progress
        if (cm.isQuestStarted(QUEST_ID)) {
            // Check if player has required items
            if (cm.haveItem(4032200, 30)) {
                cm.sendNext("Excellent! You collected all 30 #t4032200#.\r\n\r\n" +
                    "You have proven your dedication.");
            } else {
                cm.sendOk("You still need to collect 30 #t4032200#.\r\n\r\n" +
                    "Keep searching in the #m211090000#.");
                cm.dispose();
            }
            return;
        }
        // Offer quest
        cm.sendYesNo("Greetings, adventurer.\r\n\r\n" +
            "I need you to collect #b30 #t4032200##k from the monsters in " +
            "#m211090000#.\r\n\r\n" +
            "Will you help me?");
    } else if (status == 2) {
        if (!cm.isQuestStarted(QUEST_ID)) {
            // Accept quest
            cm.startQuest(QUEST_ID);
            cm.sendOk("Good luck! Return when you have 30 #t4032200#.");
        } else {
            // Complete quest
            cm.gainItem(4032200, -30); // take items
            cm.gainExp(50000);
            cm.gainMeso(10000);
            cm.completeQuest(QUEST_ID);
            cm.sendOk("Thank you! Here is your reward.\r\n\r\n" +
                "#fUI/UIWindow.img/QuestIcon/4/0# +50,000 EXP\r\n" +
                "#fUI/UIWindow.img/QuestIcon/5/0# +10,000 Meso");
        }
        cm.dispose();
    }
}
```

## Quest Script Template — Delivery Chain

**NPC A** (gives letter):
```javascript
var status = 0;
var QUEST_ID = 29001;
var LETTER_ID = 4032201; // custom item

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        if (cm.isQuestCompleted(QUEST_ID)) {
            cm.sendOk("I see you delivered the letter. Good work.");
            cm.dispose();
            return;
        }
        if (cm.haveItem(LETTER_ID)) {
            cm.sendOk("Take the letter to #p9999032# in #m990100100#.");
            cm.dispose();
            return;
        }
        cm.sendYesNo("I need you to deliver an important letter to " +
            "#p9999032# in #m990100100#.\r\n\r\n" +
            "Will you do this for me?");
    } else if (status == 2) {
        cm.startQuest(QUEST_ID);
        cm.gainItem(LETTER_ID, 1);
        cm.sendOk("Take this #t" + LETTER_ID + "# to #p9999032#.\r\n\r\n" +
            "Be careful on the way.");
        cm.dispose();
    }
}
```

**NPC B** (receives letter):
```javascript
var status = 0;
var QUEST_ID = 29001;
var LETTER_ID = 4032201;

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        if (cm.isQuestCompleted(QUEST_ID)) {
            cm.sendOk("Thank you again for the letter.");
            cm.dispose();
            return;
        }
        if (cm.haveItem(LETTER_ID)) {
            cm.sendNext("Ah, a letter from #p9999030#!\r\n\r\n" +
                "Let me read it...");
        } else {
            cm.sendOk("I do not know you. Come back if you have business here.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.gainItem(LETTER_ID, -1); // take letter
        cm.gainExp(30000);
        cm.completeQuest(QUEST_ID);
        cm.sendOk("Interesting news indeed. Thank you for delivering this.\r\n\r\n" +
            "#fUI/UIWindow.img/QuestIcon/4/0# +30,000 EXP");
        cm.dispose();
    }
}
```

## Quest Script Template — Boss Trial

```javascript
var status = 0;
var QUEST_ID = 29002;
var PROOF_ITEM = 4032202;
var TRIAL_MAP = 910000050;

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        if (cm.isQuestCompleted(QUEST_ID)) {
            cm.sendOk("You have already passed the trial.");
            cm.dispose();
            return;
        }
        if (cm.haveItem(PROOF_ITEM)) {
            cm.sendNext("You defeated your dark clone and obtained the " +
                "#t" + PROOF_ITEM + "#!\r\n\r\n" +
                "You have proven yourself worthy.");
        } else if (cm.isQuestStarted(QUEST_ID)) {
            cm.sendYesNo("You have not yet obtained the #t" + PROOF_ITEM + "#.\r\n\r\n" +
                "Do you wish to enter the trial again?");
        } else {
            cm.sendYesNo("To advance, you must face your shadow self.\r\n\r\n" +
                "Enter the trial chamber and defeat your #rDark Clone#k.\r\n" +
                "Bring back the #b#t" + PROOF_ITEM + "##k as proof.\r\n\r\n" +
                "Are you ready?");
        }
    } else if (status == 2) {
        if (cm.haveItem(PROOF_ITEM)) {
            cm.gainItem(PROOF_ITEM, -1);
            cm.completeQuest(QUEST_ID);
            cm.gainExp(100000);
            cm.sendOk("The trial is complete. You may now advance.\r\n\r\n" +
                "#fUI/UIWindow.img/QuestIcon/4/0# +100,000 EXP");
            cm.dispose();
        } else {
            if (!cm.isQuestStarted(QUEST_ID)) {
                cm.startQuest(QUEST_ID);
            }
            cm.warp(TRIAL_MAP);
            cm.dispose();
        }
    }
}
```

## Reward Scaling Guide

| Level Range | EXP Reward | Meso Reward | Notes |
|-------------|-----------|-------------|-------|
| 10-30 | 5,000-20,000 | 1,000-5,000 | Simple quests |
| 30-60 | 20,000-80,000 | 5,000-20,000 | Multi-step chains |
| 60-100 | 80,000-200,000 | 20,000-50,000 | Trial/boss quests |
| 100+ | 200,000-500,000 | 50,000-100,000 | Complex chains |

## Quest ID Registry

```
Custom quest IDs: 29000+ range
29000-29099  — General/miscellaneous quests
29100-29199  — Sage job quests
29200-29299  — Necromancer job quests
29300+       — Next available
```

## Common Quest Methods

```javascript
// Quest state
cm.isQuestStarted(questId);     // true if quest in progress
cm.isQuestCompleted(questId);   // true if quest done
cm.startQuest(questId);         // begin quest
cm.completeQuest(questId);      // finish quest

// Items (for proof/collection quests)
cm.haveItem(itemId);            // has at least 1?
cm.haveItem(itemId, count);     // has at least N?
cm.gainItem(itemId, count);     // give items (negative = take)
cm.itemQuantity(itemId);        // how many does player have?

// Rewards
cm.gainExp(amount);
cm.gainMeso(amount);
cm.gainItem(itemId, count);

// Navigation
cm.warp(mapId);                 // teleport to map
cm.warp(mapId, portalId);       // teleport to specific portal

// Always end with
cm.dispose();
```

## Checklist

- [ ] Quest ID unused (check 29000+ range)
- [ ] All NPC scripts follow Rhino JS rules (see maple-script-builder)
- [ ] `cm.dispose()` in every exit path
- [ ] Quest state checked at start (already completed? in progress?)
- [ ] Items taken from player on completion (`gainItem(id, -count)`)
- [ ] Rewards balanced for level range
- [ ] All referenced NPCs have WZ data (see maple-validator)
- [ ] All referenced maps exist
- [ ] All referenced items exist in Etc.wz/Item.wz
