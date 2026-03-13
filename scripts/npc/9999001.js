/**
 * Blacksmith Taro — NPC 9999001
 * Location: Henesys (100000000)
 * Type: Weapon & Equipment Merchant (scripted shop)
 *
 * Sells beginner-to-mid weapons for all classes at fair prices.
 * Uses scripted shop (gainItem/gainMeso) instead of DB shop tables.
 *
 * REWRITE (quality pass):
 *  - Original had broken "Browse wares" that just disposed with no shop.
 *  - Now has real weapon inventory organized by class.
 *  - Personality: gruff but kind, proud of his craft, gives forging tips.
 */
var status = 0;
var selectedCategory = -1;
var selectedItem = -1;

// [itemId, price, name]
var swords = [
    [1302000, 1000,   "Sword"],
    [1302004, 15000,  "Machete"],
    [1302009, 40000,  "Eloon"],
    [1302003, 5000,   "Viking Sword"]
];
var axes = [
    [1312004, 1000,   "Hand Axe"],
    [1312006, 15000,  "Blue Counter"],
    [1312007, 40000,  "Dark Axe"]
];
var bws = [
    [1322005, 1000,   "Wooden Mallet"],
    [1322014, 15000,  "Mithril Maul"],
    [1322015, 40000,  "Titan"]
];
var spears = [
    [1432001, 1000,   "Spear"],
    [1432002, 15000,  "Fork on a Stick"],
    [1432003, 40000,  "Nakamaki"]
];
var polearms = [
    [1442000, 1000,   "Polearm"],
    [1442001, 15000,  "Iron Ball"],
    [1442003, 40000,  "Jandinan"]
];
var potions = [
    [2000000, 40,     "Red Potion"],
    [2000001, 100,    "Orange Potion"],
    [2000002, 300,    "White Potion"],
    [2000003, 120,    "Blue Potion"],
    [2000006, 600,    "Mana Elixir"]
];

var categories = [
    { name: "One-Handed Swords", items: swords },
    { name: "One-Handed Axes",   items: axes },
    { name: "One-Handed BW",     items: bws },
    { name: "Spears",            items: spears },
    { name: "Polearms",          items: polearms },
    { name: "Potions & Supplies", items: potions }
];

function start() {
    status = 0;
    selectedCategory = -1;
    selectedItem = -1;
    cm.sendNext("#b[Blacksmith Taro]#k\r\n*wipes soot from hands*\r\n\r\nAh, a customer! Welcome to Taro's forge — finest steel in Henesys since before your parents were born.\r\n\r\nEvery blade I sell, I forged myself. None of that factory-stamped garbage from the city.");
}

function action(mode, type, selection) {
    if (mode == -1) {
        cm.dispose();
        return;
    }
    if (mode == 0 && status <= 1) {
        cm.dispose();
        return;
    }

    status++;

    if (status == 1) {
        var menu = "What brings you to my forge?\r\n";
        menu += "#L0##b Browse my weapons#k#l\r\n";
        menu += "#L1##b Tell me about yourself#k#l\r\n";
        menu += "#L2##b Any forging tips?#k#l\r\n";
        menu += "#L3##b Goodbye#k#l";
        cm.sendSimple(menu);

    } else if (status == 2) {
        if (selection == 3) {
            cm.sendOk("Come back when you need a good blade. I'll keep the forge hot.");
            cm.dispose();
            return;
        } else if (selection == 1) {
            cm.sendOk("Blacksmith Taro. Third generation. My grandfather forged swords for the Maple Knights before the war.\r\n\r\nThese days it's mostly beginners and mid-level warriors who need steel. The high-level adventurers all chase boss drops...\r\n\r\n*sighs*\r\n\r\nBut there's nothing wrong with a well-made weapon, forged with honest fire and honest hands. My blades may not glow purple, but they won't break when you need them most.");
            cm.dispose();
            return;
        } else if (selection == 2) {
            cm.sendOk("Forging tips, eh? Here:\r\n\r\n#b1.#k Don't waste scrolls on low-level gear. Save your 60%s for level 50+ equipment.\r\n\r\n#b2.#k Weapon ATT matters more than STR for warriors until late game. A +3 ATT sword beats a +5 STR sword every time.\r\n\r\n#b3.#k Always carry a backup weapon. When your main breaks in a dungeon, you'll thank me.\r\n\r\n#b4.#k The Cosmic weapons I sell are good honest steel. Better than anything the travelling merchants push.");
            cm.dispose();
            return;
        }

        // selection == 0: show categories
        var menu = "#b[Taro's Inventory]#k\r\nPick a category:\r\n\r\n";
        for (var i = 0; i < categories.length; i++) {
            menu += "#L" + i + "#" + categories[i].name + "#l\r\n";
        }
        menu += "#L" + categories.length + "#Never mind#l";
        cm.sendSimple(menu);

    } else if (status == 3) {
        if (selection == categories.length) {
            cm.sendOk("Come back anytime. The forge is always warm.");
            cm.dispose();
            return;
        }
        selectedCategory = selection;
        var cat = categories[selectedCategory];
        var menu = "#b[" + cat.name + "]#k\r\n\r\n";
        for (var i = 0; i < cat.items.length; i++) {
            var item = cat.items[i];
            menu += "#L" + i + "##i" + item[0] + "# " + item[2] + " — #r" + item[1] + " mesos#k#l\r\n";
        }
        menu += "#L" + cat.items.length + "#Back#l";
        cm.sendSimple(menu);

    } else if (status == 4) {
        var cat = categories[selectedCategory];
        if (selection == cat.items.length) {
            // Go back to categories
            status = 2;
            var menu = "#b[Taro's Inventory]#k\r\nPick a category:\r\n\r\n";
            for (var i = 0; i < categories.length; i++) {
                menu += "#L" + i + "#" + categories[i].name + "#l\r\n";
            }
            menu += "#L" + categories.length + "#Never mind#l";
            cm.sendSimple(menu);
            return;
        }
        selectedItem = selection;
        var item = cat.items[selectedItem];
        cm.sendYesNo("Buy #b" + item[2] + "#k for #r" + item[1] + " mesos#k?");

    } else if (status == 5) {
        if (mode == 0) {
            cm.sendOk("Changed your mind? No worries — browse around.");
            cm.dispose();
            return;
        }
        var cat = categories[selectedCategory];
        var item = cat.items[selectedItem];
        if (cm.getMeso() < item[1]) {
            cm.sendOk("You need #r" + item[1] + " mesos#k for that. Come back when your pockets are heavier.");
        } else if (!cm.canHold(item[0])) {
            cm.sendOk("Your inventory is full! Make some room first.");
        } else {
            cm.gainMeso(-item[1]);
            cm.gainItem(item[0], 1);
            cm.sendOk("Here you go — one #b" + item[2] + "#k, fresh from the forge.\r\n\r\n*admires the blade*\r\n\r\nTake care of it and it'll take care of you. Come back if you need an upgrade!");
        }
        cm.dispose();
    }
}
