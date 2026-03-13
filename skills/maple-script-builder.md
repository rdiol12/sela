---
name: "MapleStory Script Builder"
description: "NPC and quest script rules for Cosmic v83 Rhino JS engine. Prevents common syntax errors."
keywords: ["script", "npc script", "quest", "dialogue", "rhino", "javascript", "maple script"]
category: "gamedev"
---

# Script Builder — Cosmic v83 (Rhino JS Engine)

## HARD RULES

1. **NO template literals** — backticks `` ` `` don't work in Rhino
2. **NO bare newlines in strings** — use `\r\n` concatenation
3. **NO arrow functions** — use `function(x) { }` not `(x) => { }`
4. **NO let/const** — use `var` only
5. **NO destructuring** — use `var x = obj.x` not `var {x} = obj`
6. **NO default parameters** — use `if (x === undefined) x = default`
7. **NO spread operator** — no `...args`
8. **NO for..of loops** — use `for (var i = 0; i < arr.length; i++)`

## String Formatting

```javascript
// CORRECT
var msg = "Welcome to #b" + shopName + "#k!\r\n" +
          "\r\n" +
          "What would you like to do?\r\n" +
          "#L0#Buy items#l\r\n" +
          "#L1#Sell items#l\r\n" +
          "#L2#Leave#l";

// WRONG — crashes Rhino
var msg = "Welcome to " + shopName + "!
What would you like to do?";  // bare newline = crash

// WRONG — template literal
var msg = `Welcome to ${shopName}!`;  // backtick = crash
```

## MapleStory Text Codes

```
#b...#k     — Blue text (for emphasis)
#r...#k     — Red text
#e...#n     — Bold
#L{N}#...#l — Selection option (N = selection index)
#i{ID}#     — Show item icon
#t{ID}#     — Show item name
#m{ID}#     — Show map name
#p{ID}#     — Show NPC name
\r\n        — Newline
```

## NPC Script Template — Simple Talk

```javascript
var status = 0;

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        cm.sendNext("Page 1 of dialogue.\r\n\r\nMore text here.");
    } else if (status == 2) {
        cm.sendOk("Page 2. Goodbye!");
        cm.dispose();
    }
}
```

## NPC Script Template — Shop

```javascript
var status = 0;

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        cm.sendSimple("Welcome! What do you need?\r\n" +
            "#L0#Buy potions#l\r\n" +
            "#L1#Buy equipment#l\r\n" +
            "#L2#Just browsing#l");
    } else if (status == 2) {
        if (selection == 0) {
            cm.openShop(1000); // shop ID from data
        } else if (selection == 1) {
            cm.openShop(1001);
        } else {
            cm.sendOk("Come back anytime!");
        }
        cm.dispose();
    }
}
```

## NPC Script Template — Job Advancement

```javascript
var status = 0;

function start() { action(1, 0, 0); }

function action(mode, type, selection) {
    if (mode == -1 || (mode == 0 && status == 0)) {
        cm.dispose();
        return;
    }
    if (mode == 1) status++;
    else status--;

    if (status == 1) {
        if (cm.getJobId() == 0 && cm.getLevel() >= 10) {
            cm.sendNext("I sense great potential in you.\r\n\r\n" +
                "Are you ready to begin your journey as a #b{CLASS_NAME}#k?");
        } else if (cm.getJobId() == JOB_ID) {
            cm.sendOk("You are already a #b{CLASS_NAME}#k. Train hard!");
            cm.dispose();
        } else {
            cm.sendOk("This path is not meant for you.");
            cm.dispose();
        }
    } else if (status == 2) {
        cm.sendYesNo("I will grant you the power of #b{CLASS_NAME}#k.\r\n\r\n" +
            "Your #bSTAT#k must be at least #r20#k.\r\n\r\n" +
            "Do you accept?");
    } else if (status == 3) {
        if (cm.getStat("PRIMARY_STAT") >= 20) {
            cm.changeJob(JOB_ID);
            cm.sendOk("Congratulations! You are now a #b{CLASS_NAME}#k!\r\n\r\n" +
                "Use your new skills wisely.");
        } else {
            cm.sendOk("You need at least #r20 STAT#k to advance.");
        }
        cm.dispose();
    }
}
```

## Common CM Methods

```javascript
// Dialogue
cm.sendOk("text");              // OK button
cm.sendNext("text");            // Next button
cm.sendPrev("text");            // Prev button
cm.sendNextPrev("text");        // Both buttons
cm.sendYesNo("text");           // Yes/No buttons
cm.sendSimple("text");          // Selection menu

// Player info
cm.getLevel();                  // Current level
cm.getJobId();                  // Current job ID
cm.getStat("STR");              // Stat value (STR/DEX/INT/LUK)
cm.getMeso();                   // Meso count
cm.haveItem(itemId);            // Has item?
cm.haveItem(itemId, count);     // Has N items?
cm.getPlayer().getHp();         // Current HP
cm.getPlayer().getMp();         // Current MP

// Actions
cm.changeJob(jobId);            // Change job
cm.gainItem(itemId, count);     // Give/take items (negative to take)
cm.gainMeso(amount);            // Give/take mesos
cm.gainExp(amount);             // Give EXP
cm.warp(mapId);                 // Teleport player
cm.openShop(shopId);            // Open shop UI
cm.startQuest(questId);         // Start quest
cm.completeQuest(questId);      // Complete quest

// Always call at the end
cm.dispose();                   // Clean up NPC session
```

## Validation

Before saving a script, check:
1. No backtick characters anywhere in the file
2. No bare newlines inside string literals (search for unclosed `"`)
3. All strings use `\r\n` for newlines
4. `cm.dispose()` is called in every exit path
5. `var status = 0` is declared at top level
6. `function start()` and `function action()` both exist
