// Geprüfter Auszug aus White-Gloss/glanz-buchung-meister, src/data/site.ts, 01.10.2026.
export const catalogCheckedAt='2026-10-01';
function catalogNeed(ok,message){if(!ok)throw Object.assign(new Error(message),{status:400});}
// Fester Kundenhinweis zu allen Preisen; gilt für Angebote, Vor-Ort-Annahme und PDFs.
export const priceNote='Stellt sich der Aufwand vor Ort als höher heraus, kann sich der Preis nach Absprache mit dem Kunden noch ändern.';
// Richtwerte für die Termindauer je Paket in Minuten (Keramikschutz ca. 2 Tage).
export const packageMinutes={basis:180,premium:360,keramik:2880};
export const vehiclePanels=['Motorhaube','Dach','Heckklappe / Kofferraum','Kotflügel vorne links','Kotflügel vorne rechts','Tür vorne links','Tür vorne rechts','Tür hinten links','Tür hinten rechts','Seitenteil hinten links','Seitenteil hinten rechts','Stoßfänger vorne','Stoßfänger hinten','Schweller links','Schweller rechts','A-Säule links','A-Säule rechts','Außenspiegel links','Außenspiegel rechts','Felgen','Scheiben','Innenraum'];
export const damageKinds=['Kratzer','Delle','Steinschlag','Lackabplatzer','Riss','Swirls / Hologramme','Ätzung / Vogelkot','Wasserflecken','Rost','Fleck / Verschmutzung','Brandloch','Sonstiges'];
export const soilingLevels=['','1 · Leicht','2 · Normal','3 · Stark','4 · Extrem'];
export const intakeChecks=[['valuablesRemoved','Wertsachen entnommen bzw. mit Kunde geklärt'],['warningLights','Warnleuchten im Kombiinstrument aktiv'],['damageKnown','Vorschäden mit dem Kunden besprochen'],['waterAvailable','Wasser vor Ort verfügbar'],['powerAvailable','Strom vor Ort verfügbar']];
export function extraIncluded(packageId,extraId){return packageId==='keramik'&&['glas','leder'].includes(extraId);}
export function catalogQuote(selection){
  const pack=packages.find(p=>p.id===selection.packageId),klass=vehicleClasses.find(c=>c.id===selection.classId);
  catalogNeed(pack&&klass,'Bitte Paket und Fahrzeugklasse auswählen.');
  catalogNeed(Array.isArray(selection.extraIds)&&selection.extraIds.every(id=>typeof id==='string'),'Zusatzoptionen sind ungültig.');
  const ids=[...new Set(selection.extraIds)];
  const chosen=ids.map(id=>extras.find(e=>e.id===id));
  catalogNeed(chosen.every(e=>e&&e.requestable),'Eine Zusatzoption ist unbekannt oder derzeit nicht buchbar.');
  const selectedExtras=chosen.filter(e=>!extraIncluded(pack.id,e.id));
  catalogNeed(['Kunde bringt','Abholung'].includes(selection.delivery),'Bitte Abholung oder Kunde bringt auswählen.');
  const city=selection.citySlug?cities.find(c=>c.slug===selection.citySlug):null;
  catalogNeed(!selection.citySlug||city,'Abholort ist unbekannt.');
  let distanceKm=null,pickupCents=0,pickupOnRequest=false,pickupIncluded=false;
  if(selection.delivery==='Abholung'){
    // Without city or distance the pickup stays "on request"; a given distance must be valid.
    const known=city||(selection.pickupKm!==''&&selection.pickupKm!=null);distanceKm=city?city.km:known?Number(selection.pickupKm):null;
    catalogNeed(!known||Number.isFinite(distanceKm)&&distanceKm>=0&&distanceKm<=2000,'Bitte eine gültige einfache Abholentfernung in km angeben.');
    pickupIncluded=known&&pack.id===pickupPricing.freeWithPackageId&&distanceKm<=pickupPricing.freeUpToKm;
    const tier=known?pickupPricing.tiers.find(t=>distanceKm<=t.maxKm):null;
    pickupOnRequest=!pickupIncluded&&!tier;
    pickupCents=pickupIncluded?0:tier?.amountCents??null;
    if(pickupOnRequest&&selection.customPickupCents!==undefined&&selection.customPickupCents!==''){
      pickupCents=Number(selection.customPickupCents);
      catalogNeed(Number.isSafeInteger(pickupCents)&&pickupCents>=0,'Individuelle Abholung bitte in ganzen Centbeträgen angeben.');
    }
  }
  const packageCents=Math.round(pack.priceCents*klass.factorPercent/100);
  const extraLines=selectedExtras.map(e=>({id:e.id,name:e.name,amountCents:Math.round(e.priceCents*klass.factorPercent/100),inspect:e.inspect}));
  const extrasCents=extraLines.reduce((sum,e)=>sum+e.amountCents,0);
  return {packageId:pack.id,packageName:pack.name,classId:klass.id,className:klass.label,packageCents,extras:extraLines,extrasCents,delivery:selection.delivery,city:city?.name??'',citySlug:city?.slug??'',distanceKm,pickupIncluded,pickupOnRequest,pickupCents,totalCents:pickupCents===null?null:packageCents+extrasCents+pickupCents,checkedAt:catalogCheckedAt};
}
export function manualCatalogSource(selection){
  const quote=catalogQuote(selection);
  // A pickup outside the tiers without own price is recorded as "on request" with 0 € until priced.
  const pickupCents=quote.pickupCents??0;
  return {package:quote.packageName,packageId:quote.packageId,vehicleClass:quote.className,classId:quote.classId,extras:quote.extras.map(e=>e.name),extraIds:quote.extras.map(e=>e.id),delivery:quote.delivery,pickupKm:quote.distanceKm,amountCents:quote.packageCents+quote.extrasCents+pickupCents,pickupCents,pickupOnRequest:quote.pickupCents===null,...(quote.city?{city:quote.city,citySlug:quote.citySlug}:{}),catalogQuote:quote};
}
export const vehicleClasses = [
  {
    "id": "kompakt",
    "label": "Kompaktklasse",
    "hint": "Kleinwagen und Kompaktwagen bis 4,30 m",
    "factorPercent": 100
  },
  {
    "id": "suv",
    "label": "SUV / Limousine",
    "hint": "Mittelklasse, Kombi, SUV bis 5,00 m",
    "factorPercent": 125
  },
  {
    "id": "transporter",
    "label": "Transporter",
    "hint": "Vans und Nutzfahrzeuge über 5,00 m; Grenzfälle klären wir vor Auftragsannahme",
    "factorPercent": 155
  }
];

export const packages = [
  {
    "id": "basis",
    "name": "Basisreinigung",
    "priceCents": 14900,
    "duration": "ca. 3 Std.",
    "items": [
      "Handwäsche mit pH-neutralem Shampoo",
      "Felgen- und Reifenreinigung",
      "Innenraum: saugen, entstauben, materialgerecht reinigen",
      "Scheiben innen und außen",
      "Sprühversiegelung, Haltbarkeit ca. 3 Monate"
    ],
    "includesPickup": false
  },
  {
    "id": "premium",
    "name": "Reinigung & Politur",
    "priceCents": 34900,
    "duration": "ca. 6 Std.",
    "items": [
      "Alle Leistungen des Pakets Basisreinigung",
      "Entfernung von Lackablagerungen mit Reinigungsknete und Eisenentferner",
      "Einstufige Lackpolitur für gleichmäßigen Glanz",
      "Tiefenreinigung von Innenraum und Textilien",
      "Wachs, Haltbarkeit ca. 6 Monate"
    ],
    "includesPickup": false
  },
  {
    "id": "keramik",
    "name": "Keramikschutz",
    "priceCents": 89900,
    "duration": "ca. 2 Tage",
    "items": [
      "Reinigung und Innenraumpflege wie im Paket Reinigung & Politur; Keramikversiegelung ersetzt den Wachsauftrag",
      "Mehrstufige Lackkorrektur zur Reduzierung feiner Waschkratzer und Hologramme, soweit der Lackzustand es zulässt",
      "Keramikversiegelung mit Abperleffekt und passenden Pflegehinweisen",
      "Glas- und Felgenversiegelung für Rundumschutz",
      "Lederpflege und Tiefenimprägnierung im Innenraum",
      "Hol- und Bringservice bis 60 km inklusive"
    ],
    "includesPickup": true
  }
];

export const extras = [
  {
    "id": "felgen",
    "name": "Felgenreinigung und Versiegelung",
    "hint": "Felgen demontiert, tiefengereinigt und versiegelt",
    "priceCents": 11900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "ozon",
    "name": "Geruchsbehandlung mit Ozon",
    "hint": "Ozonbehandlung gegen Nikotin-, Tier- und Feuchtigkeitsgerüche",
    "priceCents": 9900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "motor",
    "name": "Motorraumreinigung",
    "hint": "Schonende Nassreinigung des Motorraums mit anschließender Kunststoffpflege",
    "priceCents": 9900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "leder",
    "name": "Lederpflege",
    "hint": "Tiefenreinigung und Imprägnierung aller Lederflächen",
    "priceCents": 14900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "alcantara",
    "name": "Alcantarareinigung",
    "hint": "Faserschonende Reinigung von Sitzen, Lenkrad und Dachhimmel",
    "priceCents": 9900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "dachhimmel",
    "name": "Dachhimmelreinigung",
    "hint": "Entfernung von Flecken und Grauschleiern, soweit der Materialzustand es zulässt",
    "priceCents": 13900,
    "group": "pflege",
    "inspect": true,
    "requestable": true
  },
  {
    "id": "scheinwerfer",
    "name": "Scheinwerferaufbereitung",
    "hint": "Derzeit nicht buchbar: Verfahren und Zulässigkeit müssen geklärt werden.",
    "priceCents": 9900,
    "group": "pflege",
    "inspect": false,
    "requestable": false
  },
  {
    "id": "glas",
    "name": "Scheibenversiegelung",
    "hint": "Versiegelung von Front- und Seitenscheiben für besseres Abperlen und weniger Wischergeräusche",
    "priceCents": 9900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "keramik-ultra",
    "name": "Zusätzliche Keramikschichten",
    "hint": "Zusätzlicher Schichtaufbau, nur nach Prüfung des Lacks",
    "priceCents": 69900,
    "group": "pflege",
    "inspect": true,
    "requestable": true
  },
  {
    "id": "cabrio",
    "name": "Cabrioverdeckpflege",
    "hint": "Reinigung und Imprägnierung von Stoff- oder Vinylverdecken",
    "priceCents": 17900,
    "group": "pflege",
    "inspect": true,
    "requestable": true
  },
  {
    "id": "tierhaar",
    "name": "Tierhaarentfernung",
    "hint": "Zusätzliche Entfernung von Tierhaaren aus Polstern, Teppichen und Kofferraum",
    "priceCents": 9900,
    "group": "pflege",
    "inspect": false,
    "requestable": true
  },
  {
    "id": "leder-repair",
    "name": "Lederreparatur",
    "hint": "Reparatur von Brandlöchern, Rissen und kleinen Löchern nach Materialprüfung",
    "priceCents": 13900,
    "group": "reparatur",
    "inspect": true,
    "requestable": true
  },
  {
    "id": "stoff-loch",
    "name": "Textilreparatur",
    "hint": "Reparatur an Sitz, Teppich oder Dachhimmel, sofern das Gewebe geeignet ist",
    "priceCents": 11900,
    "group": "reparatur",
    "inspect": true,
    "requestable": true
  }
];

export const cities = [
  {
    "slug": "horb-am-neckar",
    "name": "Horb am Neckar",
    "km": 0
  },
  {
    "slug": "nagold",
    "name": "Nagold",
    "km": 20
  },
  {
    "slug": "rottenburg-am-neckar",
    "name": "Rottenburg am Neckar",
    "km": 25
  },
  {
    "slug": "freudenstadt",
    "name": "Freudenstadt",
    "km": 30
  },
  {
    "slug": "oberndorf-am-neckar",
    "name": "Oberndorf am Neckar",
    "km": 30
  },
  {
    "slug": "herrenberg",
    "name": "Herrenberg",
    "km": 35
  },
  {
    "slug": "tuebingen",
    "name": "Tübingen",
    "km": 35
  },
  {
    "slug": "calw",
    "name": "Calw",
    "km": 40
  },
  {
    "slug": "balingen",
    "name": "Balingen",
    "km": 45
  },
  {
    "slug": "rottweil",
    "name": "Rottweil",
    "km": 45
  },
  {
    "slug": "boeblingen",
    "name": "Böblingen",
    "km": 50
  },
  {
    "slug": "reutlingen",
    "name": "Reutlingen",
    "km": 50
  },
  {
    "slug": "sindelfingen",
    "name": "Sindelfingen",
    "km": 52
  }
];

export const pickupPricing = {
  "tiers": [
    {
      "id": "tier_10",
      "maxKm": 10,
      "amountCents": 0,
      "label": "Abholung bis 10 km"
    },
    {
      "id": "tier_20",
      "maxKm": 20,
      "amountCents": 5000,
      "label": "Abholung bis 20 km"
    },
    {
      "id": "tier_50",
      "maxKm": 50,
      "amountCents": 7000,
      "label": "Abholung bis 50 km"
    }
  ],
  "maxKm": 50,
  "freeWithPackageId": "keramik",
  "freeUpToKm": 60
};
