// Writes the 35-product test catalogue (7 trades, 5 each) as a Shopify
// product CSV. Descriptions are written the way a shop owner types them,
// with no thought given to any extraction engine; that is the point.
//
//   npx tsx scripts/build-test-catalog.ts <output.csv>

import fs from "node:fs";

type Product = {
  handle: string; title: string; vendor: string; type: string; tags: string;
  price: number; image: string; body: string;
};

// Written as an actual, unprepared shop owner would type them: casual,
// numbers smashed against units the way people type in a hurry, no thought
// given to what any extraction engine might want. Facts are real and present
// (a real owner does list specs), just not standardised.
const products: Product[] = [
  { handle: "wireless-earbuds-x2", title: "Wireless Earbuds X2", vendor: "SoundNest", type: "Electronics", tags: "electronics",
    price: 59.99, image: "https://images.pexels.com/photos/33797659/pexels-photo-33797659.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Got these in a few weeks ago, wireless earbuds, bluetooth obviously. Sound is decent for the price honestly, bass is there. Battery in the earbuds themselves lasts maybe 5-6hrs and the case tops it up a few more times so you're looking at like a full day easy. Charges over usb-c which is nice since everyone has that cable now. They come in a little case with 3 tip sizes so should fit most people. Water resistant enough for the gym or if it rains a bit, wouldnt go swimming in them though. 2 year warranty on these if anything goes wrong just bring your receipt." },
  { handle: "fitness-smartwatch-pulse", title: "Fitness Smart Watch Pulse", vendor: "TrackWell", type: "Electronics", tags: "electronics",
    price: 45, image: "https://images.pexels.com/photos/7671474/pexels-photo-7671474.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Watch that tracks steps and your heart rate, sleep too apparently though I dont fully trust the sleep tracking on any of these tbh. Screen is touch, about an inch and a half maybe, easy enough to see. Battery is actually really good, week or so before you need to charge again which beats a lot of the smart watches out there. Charges with a little magnetic clip thing, comes in the box. Works with iphone and android both, you download the app first. 50m water resistant so showers fine, wouldnt take it in a hot tub or anything crazy. Strap is silicone, comes in black or blue, you can buy other straps separately if you want a change. 1 year warranty, standard." },
  { handle: "bluetooth-speaker-roam", title: "Portable Bluetooth Speaker Roam", vendor: "EchoBase", type: "Electronics", tags: "electronics",
    price: 34.5, image: "https://images.pexels.com/photos/4917455/pexels-photo-4917455.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Small speaker, gets loud for its size honestly surprised us. About 10 hours of music on a charge at a normal volume, less if you're blasting it. USB-C to charge, couple hours to full. Bluetooth connects to two phones same time which is good for when youre out with someone. Its rated ipx7 so if it goes in the pool by accident its fine, has happened here in the shop actually. Comes with a clip so you can hook it to a bag. 1 year warranty." },
  { handle: "compact-digital-camera-snap", title: "Compact Digital Camera Snap 200", vendor: "LensCraft", type: "Electronics", tags: "electronics",
    price: 89, image: "https://images.pexels.com/photos/15631397/pexels-photo-15631397.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Basic point and shoot, nothing crazy but does the job for holidays and stuff. 20mp camera, 5x zoom on the lens. Screen on the back is 3 inches, no touch. Uses a microsd card which you have to buy separate, get at least a 32gb one. Battery does around 300 photos a charge which is plenty really. Transfers photos over usb-c to your computer, no wifi on this one unfortunately. Small enough for a jacket pocket. Comes with a strap. 2 years warranty." },
  { handle: "android-tablet-pageflow", title: "Android Tablet PageFlow 10", vendor: "NovaTech", type: "Electronics", tags: "electronics",
    price: 129, image: "https://images.pexels.com/photos/28582719/pexels-photo-28582719.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "10in tablet, good for reading or the kids watching cartoons. 64gb storage but you can pop in a memory card for more if needed. Ram is 4gb so its fine for browsing, not gonna run heavy games well. Battery lasts about 8 hours on video. Wifi only, no sim slot. Cameras are basic, 5mp front and back, ok for video calls. Comes with charger and cable, no case so maybe grab one. 1 year warranty from when you bought it." },

  { handle: "smartphone-nova-12", title: "Smartphone Nova 12", vendor: "NovaTech", type: "Mobile Phones", tags: "phones",
    price: 649, image: "https://images.pexels.com/photos/3945672/pexels-photo-3945672.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Newest phone we've got in. Screen is 6.5in, amoled panel so the colors pop and blacks are actually black. 90hz so its smooth scrolling through stuff. Comes with 128gb storage, no card slot so get the size you need now. 6gb ram. Camera is 3 lenses on back, main one is 50mp plus wide and macro. Battery 5000mah, easily lasts all day, charges fast too like 30 mins to half. Has 5g, wifi, bluetooth, nfc for tap to pay. Water resistant. Comes in black blue or green. Comes with a case and cable in box, no charger anymore apparently thats just how it is now. 2 year warranty." },
  { handle: "smartphone-lumen-8", title: "Smartphone Lumen 8", vendor: "ClearView", type: "Mobile Phones", tags: "phones",
    price: 249, image: "https://images.pexels.com/photos/215581/pexels-photo-215581.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Cheap phone that still does what most people need honestly. Screen 6.1in, its lcd not amoled so blacks look more grey but for the price its fine. 64gb storage, has a card slot if you need more room. 4gb ram. Two cameras on back, 13mp main. Battery 4000mah lasted us about a day and a half normal use. Charging is slow, no fast charge here, 2hrs to full. 4g not 5g, still has wifi and bluetooth obviously. Black or silver. Comes with charger and cable. 1 year warranty." },
  { handle: "smartphone-orbit-x", title: "Smartphone Orbit X", vendor: "OrbitMobile", type: "Mobile Phones", tags: "phones",
    price: 429, image: "https://images.pexels.com/photos/47261/pexels-photo-47261.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Mid range one, screen 6.4in oled, 120hz refresh so games feel smooth. 256gb storage, no expanding it. 8gb ram, handles most games no problem. Triple camera, 64mp main with a telephoto that does 3x zoom which is nice at this price point. Battery 4500mah, fast charge gets you full in under an hour. Also does wireless charging if you have a pad, sold separate. 5g, wifi, bluetooth, nfc, and its dual sim so 2 numbers if you need that. Rated ip68 water/dust. Black graphite or midnight blue. 2 years warranty." },
  { handle: "smartphone-basic-call", title: "Smartphone Basic Call 5G", vendor: "ClearView", type: "Mobile Phones", tags: "phones",
    price: 159, image: "https://images.pexels.com/photos/7068406/pexels-photo-7068406.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Simple phone, calls texts maps basic apps, dont expect much more. Screen is 6in, lcd, 60hz nothing special. 32gb storage, has card slot. 3gb ram so dont load it up with apps. Single camera 8mp, does the job for quick pics. Battery 3500mah, charges slow, like 3hrs. Has 5g surprisingly for the price, plus wifi bluetooth. Just comes in black. Box has phone charger cable, no case. 1 year warranty." },
  { handle: "smartphone-flex-fold", title: "Smartphone Flex Fold Mini", vendor: "OrbitMobile", type: "Mobile Phones", tags: "phones",
    price: 899, image: "https://images.pexels.com/photos/19281806/pexels-photo-19281806.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Our folding phone. Opens up to 7.6in screen, folded its basically a small phone in your pocket. Outside cover screen is 6.2in for quick stuff without opening it up. 256gb storage, 12gb ram so multitasking on the big screen works well. Triple camera, 50mp main plus wide and tele. Battery 4400mah, fast charge to 50% in like 25 min. 5g wifi bluetooth nfc, esim only no physical sim tray because of how the hinge is built. Water resistant rated ipx8, no dust rating cause of the hinge gap. Comes in graphite. 2 year warranty, hinge included in that." },

  { handle: "laptop-workhorse-14", title: "Laptop Workhorse 14", vendor: "NovaTech", type: "Laptops", tags: "laptops",
    price: 549, image: "https://images.pexels.com/photos/3747070/pexels-photo-3747070.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Everyday laptop, work stuff, spreadsheets, browsing, not for gaming. 14in screen, fhd, matte so no glare by a window. Processor is quad core around 2.4ghz, fine for office work. 8gb ram, cant upgrade it later since its soldered in so pick your size now. 256gb ssd, boots quick, fills up fast if you keep videos on it. Graphics is integrated, not for anything heavy. Battery about 8hrs normal, less if brightness is all the way up. Wifi bluetooth, 2 usb-c 1 usb-a, no ethernet so youd need an adapter. Windows comes preinstalled. Weighs 1.4kg. Comes with charger and a basic sleeve. 2 year warranty." },
  { handle: "laptop-creator-16", title: "Laptop Creator 16", vendor: "PixelForge", type: "Laptops", tags: "laptops",
    price: 999, image: "https://images.pexels.com/photos/7485213/pexels-photo-7485213.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "This ones for people editing photos or video mostly, not a gaming laptop but handles more than the basic ones. 16in screen, qhd, colors are noticeably better than the cheap ones we usually sell. 8 core processor, 3.2ghz. 16gb ram, can upgrade to 32gb if you or we open it up. 512gb ssd, nvme so file transfers are quick. Dedicated graphics with 6gb vram, runs lightroom and premiere without too much stutter. Battery like 6hrs when actually editing stuff, more if just browsing. Wifi bluetooth usb-c usb-a hdmi and sd card reader which is handy straight off a camera. Windows. Weighs 2.1kg, on the heavy side. Comes with charger, no sleeve this time. 2 years warranty." },
  { handle: "laptop-lite-11", title: "Laptop Lite 11", vendor: "ClearView", type: "Laptops", tags: "laptops",
    price: 279, image: "https://images.pexels.com/photos/8534160/pexels-photo-8534160.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Small light one, good for school or basic stuff, dont expect power from it. 11.6in screen, hd not fhd so text looks a little soft up close. Dual core, 1.8ghz. 4gb ram, not upgradable. 128gb ssd fills up fast if you install a lot. Integrated graphics only. Battery is actually the best part, like 10hrs on normal stuff. Wifi bluetooth, usb-a ports only, no usb-c no hdmi which surprised us too honestly. Runs chromeos. Just 1.1kg so kids can carry it fine in a backpack. Comes with charger and a thin sleeve. 1 year warranty." },
  { handle: "laptop-office-pro", title: "Laptop Office Pro 15", vendor: "NovaTech", type: "Laptops", tags: "laptops",
    price: 749, image: "https://images.pexels.com/photos/1128207/pexels-photo-1128207.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Reliable one for an office setup, nothing exciting but wont let you down either. 15.6in fhd screen, glossy. Quad core 2.6ghz, 12th gen. 16gb ram, upgradable to 32gb. 512gb ssd. Integrated graphics. Battery about 9hrs, one of the better ones we sell for that. Wifi bluetooth usb-c usb-a hdmi and it has an ethernet port too which some people specifically ask for. Windows comes with license already activated. 1.7kg. Comes with charger and sleeve this time. 3 year warranty, longer than usual since its meant for business buyers." },
  { handle: "laptop-budget-book", title: "Laptop Budget Book 14", vendor: "ClearView", type: "Laptops", tags: "laptops",
    price: 219, image: "https://images.pexels.com/photos/20432916/pexels-photo-20432916.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Cheapest laptop we carry, does basic stuff fine, dont buy it expecting speed. 14in hd screen, matte. Dual core 2.0ghz. 4gb ram, soldered so cant upgrade. 64gb ssd, fills up fast so most people add cloud storage or a memory card right away. Integrated graphics. Battery about 6hrs. Wifi bluetooth, 2 usb-a ports, no usb-c no hdmi. Runs windows in s mode which some people find annoying since it limits what you can install til you switch it off. 1.5kg. Comes with charger only, no sleeve. 1 year warranty." },

  { handle: "gold-ring-classic", title: "Classic Gold Ring", vendor: "AuroraGems", type: "Jewellery", tags: "jewelry",
    price: 210, image: "https://images.pexels.com/photos/11378845/pexels-photo-11378845.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Simple gold ring, 14k, nothing flashy just a clean band for everyday. Adjustable so fits most fingers, if it doesnt fit right bring it back and well look at resizing it. Weighs about 3g so light enough you forget its there. Good for everyday, could work as a simple engagement thing too or just a gift. Comes in a little velvet box. We dont do engraving here at the moment, sorry, might add that later." },
  { handle: "silver-necklace-drop", title: "Silver Drop Necklace", vendor: "AuroraGems", type: "Jewellery", tags: "jewelry",
    price: 45, image: "https://images.pexels.com/photos/39326351/pexels-photo-39326351.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Sterling silver necklace, little pendant drops just below the collarbone on most people. 925 stamped on the clasp so you know its the real stuff. Stone is a small zirconia, not a real diamond, being upfront about that, still catches light nice though. Chain is 45cm with a 5cm extender so should fit most necks. Lobster clasp, easy enough to do yourself once you get the hang of it. Comes in a pouch not a box, ran out of boxes this batch sorry. Good for a birthday or anniversary gift or just because." },
  { handle: "rose-gold-bracelet", title: "Rose Gold Bracelet", vendor: "AuroraGems", type: "Jewellery", tags: "jewelry",
    price: 38, image: "https://images.pexels.com/photos/6716441/pexels-photo-6716441.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Rose gold plated bracelet, thin chain, looks better in person than in photos honestly. Its plated over brass, not solid gold, want to be upfront since the price reflects that. Adjustable 16 to 20cm with the extension. Lobster clasp, small one so might be fiddly with bigger fingers, might need someone to help clip it on. Works for everyday or as a gift, not really formal enough for a big event on its own. Comes in a simple pouch." },
  { handle: "pearl-stud-earrings", title: "Pearl Stud Earrings", vendor: "AuroraGems", type: "Jewellery", tags: "jewelry",
    price: 32, image: "https://images.pexels.com/photos/36823005/pexels-photo-36823005.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Freshwater pearl studs, each pearl is around 8mm, good middle size. Posts are sterling silver, hypoallergenic for most people but check with a doctor if you know you have metal allergies. Push back closure, secure enough for everyday. These are real pearls not glass so expect small natural differences between the pair, thats normal for real ones. Good for weddings, everyday, or a gift for someone who likes simple over flashy. Comes in a small box." },
  { handle: "diamond-pendant-solitaire", title: "Diamond Solitaire Pendant", vendor: "AuroraGems", type: "Jewellery", tags: "jewelry",
    price: 395, image: "https://images.pexels.com/photos/10215179/pexels-photo-10215179.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Small diamond pendant, stone is 0.15ct so dont expect a big rock, more of a subtle everyday piece. 18k gold. Real diamond, we can get you the certificate if you ask at checkout. Chain included, 42cm, silver plated to match. Spring ring clasp. Works for engagement adjacent gifts, anniversaries, or just treating yourself. Comes in a proper gift box this time. No standard warranty on jewelry but we cover manufacturing faults for 6 months." },

  { handle: "blood-pressure-monitor-home", title: "Home Blood Pressure Monitor", vendor: "VitalCheck", type: "Medical Devices", tags: "medical",
    price: 39, image: "https://images.pexels.com/photos/8088865/pexels-photo-8088865.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Arm cuff monitor for checking bp at home, doctor recommended we're told though havent verified that ourselves so take it with a grain of salt. Reads 0-280 for pressure and 40-199 for pulse. Cuff is nylon, adjustable, fits 22-42cm arms which covers most people. Runs on 4 aa batteries not included, or use the usb cable thats in the box. Ce marked. Meant for home use, adults, not for kids. Comes with a case and a manual. 2 year warranty." },
  { handle: "digital-thermometer-fast", title: "Digital Thermometer Fast Read", vendor: "VitalCheck", type: "Medical Devices", tags: "medical",
    price: 15, image: "https://images.pexels.com/photos/5712673/pexels-photo-5712673.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Basic thermometer, reads in about 10 seconds, faster than the old mercury ones nobody uses anymore anyway. Range is 32 to 42.9 degrees. Medical grade plastic, waterproof tip so you can actually clean it properly. Runs on 1 button battery, included, replace it eventually when it dies. Ce marked, also says fda registered on the box. Home use, fine for adults and kids, oral underarm or other ways depending how you use it, check the leaflet that comes with it. Comes with a hard case. 1 year warranty." },
  { handle: "pulse-oximeter-finger", title: "Fingertip Pulse Oximeter", vendor: "VitalCheck", type: "Medical Devices", tags: "medical",
    price: 22, image: "https://images.pexels.com/photos/6285400/pexels-photo-6285400.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Clips on your finger, gives you an oxygen percentage and pulse in a few seconds. Reads 35-100% oxygen and 30-250 pulse. Plastic housing with a silicone cushion inside so it doesnt pinch too hard. 2 aaa batteries included this time. Ce marked, box says clinically tested though we havent seen the actual study ourselves. Home use, one person really, not something you pass around a whole household. Comes with a lanyard and small pouch. 1 year warranty." },
  { handle: "knee-support-brace", title: "Adjustable Knee Support Brace", vendor: "VitalCheck", type: "Medical Devices", tags: "medical",
    price: 24, image: "https://images.pexels.com/photos/38074530/pexels-photo-38074530.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Knee brace for support during exercise or if youre recovering from something, not a replacement for actual treatment obviously, see a doctor for anything serious. Neoprene with elastic straps, lining is hypoallergenic. One size fits most, straps let you get it snug. Roughly fits 30-50cm knee circumference. For home use or light exercise, reusable, wash by hand and air dry it. Ce marked. Just comes in black. 6 month warranty against stitching issues." },
  { handle: "nebulizer-compact-home", title: "Compact Home Nebulizer", vendor: "VitalCheck", type: "Medical Devices", tags: "medical",
    price: 45, image: "https://images.pexels.com/photos/7447013/pexels-photo-7447013.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Nebulizer turns liquid meds into a mist you breathe in, mostly used for asthma type stuff, always follow what your doctor actually prescribed not what we say here obviously. Mains powered, comes with a uk plug, also works off usb if you have a power bank for travel. Mask and tubing is medical silicone and pvc, both included, theres a kid size and adult size mask in the box. Ce marked, says mdr compliant on the paperwork. Home use, reusable, needs cleaning after every use per the instructions. 2 year warranty on the motor, the mask and stuff isnt covered since its a consumable." },

  { handle: "vitamin-c-1000", title: "Vitamin C 1000 Tablets", vendor: "PureLeaf", type: "Supplements", tags: "supplements",
    price: 12.5, image: "https://images.pexels.com/photos/11348089/pexels-photo-11348089.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Vitamin c tablets, 1000mg each, one a day is what it suggests though obviously check with your own doctor if unsure. Tablets, easy to swallow, not the giant horse pill kind thankfully. 90 in the bottle so about 3 months if you do one a day. Vegan, no gelatin in the coating. For adults, not tested for kids or pregnancy so check with someone first. Gmp certified, made in a place that also handles other supplements so if you have bad allergies read the full label." },
  { handle: "whey-protein-vanilla", title: "Whey Protein Powder Vanilla", vendor: "PureLeaf", type: "Supplements", tags: "supplements",
    price: 28, image: "https://images.pexels.com/photos/13779103/pexels-photo-13779103.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Protein powder, vanilla, mixes fine in water or milk, we like milk personally but water works if youre watching calories. Whey isolate, 24g protein a scoop which is decent post workout. 30 scoops in the tub, one a day if youre using it daily. Mostly for gym people though anyone wanting more protein could use it. Has milk in it obviously since its whey, not vegan, we do carry a plant one separately if you need that. Third party tested for banned stuff which matters if you compete in anything." },
  { handle: "omega-3-fish-oil", title: "Omega 3 Fish Oil Softgels", vendor: "PureLeaf", type: "Supplements", tags: "supplements",
    price: 19, image: "https://images.pexels.com/photos/29060398/pexels-photo-29060398.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Fish oil softgels, 1000mg per cap, of which only about 300mg is actual omega 3 epa/dha, rest is other fish oil stuff, worth knowing since some brands just quote the big number to look better. Softgel obviously. 120 in the bottle so 4 months at 1 a day or 2 months at 2. For adults mostly, smaller dose for kids sometimes but check with a pharmacist. Not vegan, its fish, we have an algae version if you need that instead. Third party tested, also tested for mercury which is a common worry with fish oil." },
  { handle: "multivitamin-gummies-adult", title: "Adult Multivitamin Gummies", vendor: "PureLeaf", type: "Supplements", tags: "supplements",
    price: 16, image: "https://images.pexels.com/photos/14027301/pexels-photo-14027301.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Gummy vitamins for people who hate swallowing pills, taste is alright, bit sweet but not bad. 60 in the bottle, 2 a day so a month per bottle. Mix of stuff, vitamin c, d, b12 and a few others, full list is on the label since theres too much to list here. Vegetarian not vegan, has gelatin in it from what we understand. For adults, dont give to little kids, keep out of reach since they look and taste like candy basically. Gmp certified." },
  { handle: "magnesium-glycinate-caps", title: "Magnesium Glycinate Capsules", vendor: "PureLeaf", type: "Supplements", tags: "supplements",
    price: 14, image: "https://images.pexels.com/photos/13779106/pexels-photo-13779106.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Magnesium caps, a lot of people ask for these for sleep or cramps though we cant make medical claims here so just going off what customers tell us. 400mg per cap. Capsules. 90 in the bottle, 3 months at one a day. Vegan and gluten free per the label. For adults, check with a doctor if pregnant like with any supplement really. Lab tested, we can forward the batch results if you email and ask, thats what the manufacturer sent us." },

  { handle: "cotton-tshirt-basic", title: "Basic Cotton T Shirt", vendor: "WearWell", type: "Clothing", tags: "clothing",
    price: 18, image: "https://images.pexels.com/photos/18257675/pexels-photo-18257675.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Plain tee, nothing exciting but does the job and holds up in the wash. 100% cotton, feels soft, bit thin honestly so maybe not the warmest for winter. Regular fit, not slim not oversized, true to size based on what customers tell us. Sizes s to xl. Short sleeve. White black or navy. Plain, no print. Machine washable, wed avoid the tumble dryer to keep the shape even though the label says its fine. Fine all year really, layer it up in winter." },
  { handle: "fleece-hoodie-warm", title: "Warm Fleece Hoodie", vendor: "WearWell", type: "Clothing", tags: "clothing",
    price: 42, image: "https://images.pexels.com/photos/2108816/pexels-photo-2108816.png?auto=compress&cs=tinysrgb&w=1200",
    body: "Hoodie for the colder months, fleece lined inside so warmer than it looks from outside. Cotton poly blend, mostly poly actually with the fleece brushed inside. Relaxed fit, runs a bit big so maybe size down if you like things fitted. S to xxl. Drawstring hood and front pocket, no zip this one pulls over your head. Grey black or maroon. Mostly a winter or autumn thing, bit warm for summer obviously. Machine washable, wash cold so the color doesnt fade." },
  { handle: "denim-jeans-straight", title: "Straight Fit Denim Jeans", vendor: "WearWell", type: "Clothing", tags: "clothing",
    price: 55, image: "https://images.pexels.com/photos/1082526/pexels-photo-1082526.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Denim jeans, straight fit, not skinny not baggy, somewhere in between which is what most people want these days. Denim with a bit of elastane in it for stretch so not stiff like old school jeans. Button and zip fly. Mid blue wash, we also do a black version separate. Plain denim, no rips or distressing on this basic one. Wash inside out, cold water, dont tumble dry too much or the stretch wears out faster." },
  { handle: "summer-dress-floral", title: "Floral Summer Dress", vendor: "WearWell", type: "Clothing", tags: "clothing",
    price: 39, image: "https://images.pexels.com/photos/29277214/pexels-photo-29277214.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Light dress for summer, floral print, comfortable for all day in the heat. Viscose, breathable, does wrinkle a bit if you pack it in a suitcase so hang it up when you get there. Relaxed through the body. Xs to xl. Short sleeve, small elastic at the waist for shape. Floral obviously, mostly blue and yellow tones in the print. Summer or spring thing, would layer with a jacket if it cools off in the evening. Hand wash recommended, gentle machine cycle should be fine too from what weve seen." },
  { handle: "winter-jacket-padded", title: "Padded Winter Jacket", vendor: "WearWell", type: "Clothing", tags: "clothing",
    price: 68, image: "https://images.pexels.com/photos/19245663/pexels-photo-19245663.jpeg?auto=compress&cs=tinysrgb&w=1200",
    body: "Proper winter jacket, padded, keeps you warm even on the really cold days, we tested it ourselves standing outside the shop one cold morning and it held up fine. Polyester shell with synthetic padding inside, not down, so fine for people who dont want animal products. Regular fit, room for a jumper underneath. S to xxl. Front zip plus a couple snap buttons over the top. Black navy or khaki. Winter thing obviously, too warm for anything else. Machine washable, wed say low temp wash and hang dry instead of the dryer to protect the padding." },
];

const headers = [
  "Handle","Title","Body (HTML)","Vendor","Type","Tags","Published","Option1 Name","Option1 Value",
  "Variant SKU","Variant Grams","Variant Inventory Tracker","Variant Inventory Qty","Variant Inventory Policy",
  "Variant Fulfillment Service","Variant Price","Variant Requires Shipping","Variant Taxable",
  "Image Src","Image Position","Image Alt Text","Gift Card","SEO Title","SEO Description","Status",
];

function csvField(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

const lines = [headers.join(",")];
for (const p of products) {
  const row = [
    p.handle, p.title, `<p>${p.body}</p>`, p.vendor, p.type, p.tags, "TRUE", "Title", "Default Title",
    p.handle.toUpperCase(), "", "shopify", "25", "deny", "manual", String(p.price), "TRUE", "TRUE",
    p.image, "1", p.title, "FALSE", p.title, "", "active",
  ].map(csvField);
  lines.push(row.join(","));
}

const out = process.argv[2];
if (!out) {
  console.error("usage: npx tsx scripts/build-test-catalog.ts <output.csv>");
  process.exit(1);
}
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${products.length} products`);
