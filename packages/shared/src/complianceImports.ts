export type ImportedChecklistTemplate = {
  name: string;
  area: string;
  venue: 'Alma Avalon' | 'St Alma' | 'Both';
  sourceFile: string;
  reviewStatus: 'active' | 'needs_review' | 'archive';
  items: Array<[label: string, description: string]>;
};

export type ImportedComplianceDocument = {
  title: string;
  venue: 'Alma Avalon' | 'St Alma' | 'Both';
  category: 'Checklist' | 'Licensing' | 'Handbook' | 'SOP' | 'Training' | 'Menu' | 'Staff records';
  reviewStatus: 'active' | 'needs_review' | 'archive';
  sourcePath: string;
  notes: string;
};

const dropboxRoot = '/Users/timothychristensen/Library/CloudStorage/Dropbox/Family Room/ALMA (1)/ALMA (1)';

export const ALMA_IMPORTED_CHECKLIST_TEMPLATES: ImportedChecklistTemplate[] = [
  {
    name: 'St Alma FOH Opening Checklist',
    area: 'St Alma FOH',
    venue: 'St Alma',
    sourceFile: `${dropboxRoot}/St Alma/Checklists and prodecures/St.Alma FOH Open.xlsx`,
    reviewStatus: 'active',
    items: [
      ['Sign into Deputy', 'Confirm the opening manager and roster are live in Deputy.'],
      ['Turn on venue lights', 'Bar dimmers, restaurant Tridonic scenes, host desk, exterior lights, and fans as required.'],
      ['Check phone messages', 'Check voicemails and texts, update reservation notes, and respond where required.'],
      ['Complete brief sheet and turn sheet', 'Complete the A4 briefing folder and turn sheet, then place the brief on the host desk.'],
      ['Prepare waiter stations', 'Fill spray bottles, clean towel, pad, pen, iPad, and paired Lightspeed.'],
      ['Clean front door and fish display', 'Windex the front door and fish display before service.'],
      ['Set heating and cooling', 'Turn on air conditioning or heater as required.'],
      ['Check bookings and set tables', 'Review ResyOS and set the restaurant according to bookings.'],
      ['Start music', 'Use Sonos/Spotify and select the correct AM or PM St Alma playlist.'],
      ['Clear foyer and chair storage', 'Pack chairs into the store room and keep the foyer clear.'],
      ['Check change float', 'Confirm $400 in small denominations and arrange Bendigo Bank change if required.'],
      ['Restock bathrooms', 'Confirm bathrooms are clean and stocked with toilet paper and hand soap.'],
      ['Polish cutlery and stock stations', 'Prepare cutlery and station stock for service.'],
      ['Spot sweep public areas', 'Spot sweep restaurant floor, bathroom, and entrance.'],
      ['Set music and lights 15 minutes before opening', 'Confirm ambience is ready before doors.'],
      ['Complete weekly opening notes', 'Wednesday windows, towel collection/drop-off, coffee run, and contractor notes where relevant.']
    ]
  },
  {
    name: 'St Alma FOH Closing Checklist',
    area: 'St Alma FOH',
    venue: 'St Alma',
    sourceFile: `${dropboxRoot}/St Alma/Checklists and prodecures/St.Alma FOH Close .xlsx`,
    reviewStatus: 'active',
    items: [
      ['Remove lamps and charge them', 'Remove table lamps and place them on charge in the service cupboard.'],
      ['Clean all tables', 'Clean all restaurant tables after service.'],
      ['Clean bathrooms', 'Sweep and mop bathrooms, empty pedal bins with gloves, sanitise sinks, handles, bench tops, hand dryers, flush buttons, seats, lids, and bins.'],
      ['Dispose of cleaning cloths', 'Dispose of used chux cloths in the bin.'],
      ['Restock bathrooms', 'Refill hand soap and toilet paper.'],
      ['Clean mirrors', 'Polish bathroom mirrors.'],
      ['Polish and restock cutlery', 'Polish cutlery with hot water and vinegar, then restock stations.'],
      ['Clean and restack menus', 'Wipe menus inside and out, stack on the service shelf, and reprint a la carte menus if needed.'],
      ['Dock iPads and Lightspeeds', 'Dock devices, confirm they are charging, and turn iPads off on exit.'],
      ['Store soiled tablecloths', 'Place soiled tablecloths in a sealed tub in the storeroom.'],
      ['Sweep and mop restaurant floor', 'Use hot water and confirm mop and bucket are clean and free from grease.'],
      ['Check phone messages', 'Check all messages before leaving.'],
      ['Lock windows', 'Close and lock main facade and bar windows.'],
      ['Turn off lights and air conditioning', 'Confirm lights and air conditioning are off.'],
      ['Sign out of Deputy', 'Complete Deputy sign-out and engagement notes.']
    ]
  },
  {
    name: 'Alma Avalon FOH Opening Checklist',
    area: 'Alma Avalon FOH',
    venue: 'Alma Avalon',
    sourceFile: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/FOH Open.xlsx`,
    reviewStatus: 'active',
    items: [
      ['Sign into Deputy', 'Confirm roster and opening manager are live in Deputy.'],
      ['Turn lights on', 'Turn on bar drop lights, shelves, restaurant wall lanterns, and front door lanterns.'],
      ['Check voicemail and respond', 'Check phone messages and respond before service.'],
      ['Set heating, fireplace, fans, or deck heaters', 'Adjust weather-dependent comfort settings.'],
      ['Complete brief sheet', 'Confirm 86 items and staff allocations.'],
      ['Set outdoor furniture', 'Position outdoor furniture according to the floorplan.'],
      ['Set blankets if cold', 'Drape green blankets over outdoor and deck chairs when needed.'],
      ['Check bookings and set tables', 'Review Resy and set tables accordingly.'],
      ['Start Alma playlist', 'Start the correct AM or PM playlist.'],
      ['Spot clean windows', 'Check windows and spot clean where necessary.'],
      ['Check change float', 'Confirm $400 in small denominations.'],
      ['Check bathrooms', 'Confirm bathrooms are set and fully stocked.'],
      ['Polish cutlery', 'Polish enough cutlery for service.'],
      ['Clear deck and street front', 'Use the leaf blower to clear debris from deck and street front.'],
      ['Set waiter stations', 'Set bamboo box, cloth, sanitiser, iPad, Tyro, waiters pad, and pen at deck, bar, and kitchen pass.'],
      ['Set deck station', 'Set menus, water bottles, glasses, and cutlery on deck.'],
      ['Open doors at 11:30', 'Confirm the floor is ready before doors open.']
    ]
  },
  {
    name: 'Alma Avalon FOH Closing Checklist',
    area: 'Alma Avalon FOH',
    venue: 'Alma Avalon',
    sourceFile: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/FOH Close .xlsx`,
    reviewStatus: 'active',
    items: [
      ['Remove lamps and charge globes', 'Place globes on charge in the service cupboard and stack bases on the chemical shelf in the carpark.'],
      ['Sanitise tables and chairs', 'Sanitise all tables and place chairs upside down where practical.'],
      ['Spray and mop restaurant', 'Use Wocca or Formula 1 in warm water and fresh attachments where required.'],
      ['Clean bathrooms', 'Sweep and mop, empty bins with gloves, sanitise sinks, handles, bench tops, dryers, flush buttons, seats, lids, and bins.'],
      ['Restock bathrooms', 'Refill hand soap and toilet paper from carpark/upstairs storage.'],
      ['Clean mirrors', 'Polish bathroom mirrors.'],
      ['Polish cutlery', 'Polish all cutlery.'],
      ['Clean and restack menus', 'Wipe menus inside and out, then stack neatly on the service shelf.'],
      ['Sweep outside area', 'Ensure there is no Alma debris outside.'],
      ['Dock iPads and Tyros', 'Dock three iPads and three Tyros, confirm charging, and turn iPads off.'],
      ['Replace tea light candles', 'Put tea lights through pot wash if required.'],
      ['Fold blankets', 'Fold blankets neatly and stack on banquet seating.'],
      ['Clear deck for external cleaners', 'Make sure cleaners have clear deck access.'],
      ['Lock windows', 'Close and lock street-facing and coffee bar windows.'],
      ['Turn off lights, heaters, and fireplace', 'Use service sink switches, heater keys, and fireplace dials/power button.'],
      ['Sign out of Deputy', 'Complete close sign-out.']
    ]
  },
  {
    name: 'Alma Avalon Manager New Employee Checklist - Review',
    area: 'Management',
    venue: 'Alma Avalon',
    sourceFile: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Management Checklist/Manager New Employee Checklist.docx`,
    reviewStatus: 'needs_review',
    items: [
      ['Review manager new employee checklist', 'Confirm this old manager checklist still matches the Staff app onboarding flow before using live.'],
      ['Compare against Staff onboarding requirements', 'Tax, super, bank, visa, venue, role, documents, and approvals should be checked in Staff.'],
      ['Archive or rewrite old duplicate steps', 'Do not keep duplicate onboarding instructions in Compliance once Staff is source of truth.']
    ]
  },
  {
    name: 'Alma Avalon Food Poisoning Allegation SOP - Review',
    area: 'SOP',
    venue: 'Alma Avalon',
    sourceFile: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/1. Food Poisioning Allegation.docx`,
    reviewStatus: 'needs_review',
    items: [
      ['Confirm allegation intake details are current', 'Review contact details, escalation path, and incident register process.'],
      ['Confirm evidence retention process', 'Check food samples, supplier batch records, prep logs, and staff statements.'],
      ['Confirm follow-up owner', 'Assign manager responsible for customer contact and authority notification if required.']
    ]
  },
  {
    name: 'Alma Avalon Guest Complaint SOP - Review',
    area: 'SOP',
    venue: 'Alma Avalon',
    sourceFile: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/2. Guest Complaint.docx`,
    reviewStatus: 'needs_review',
    items: [
      ['Confirm complaint capture process', 'Record guest details, date, staff involved, and immediate action.'],
      ['Confirm escalation rules', 'Clarify when complaints go to venue manager, operations, or ownership.'],
      ['Confirm closure notes', 'Record resolution, refund/credit if any, and follow-up required.']
    ]
  },
  {
    name: 'Alma Avalon Booking Guidelines and Capacity SOP - Review',
    area: 'SOP',
    venue: 'Alma Avalon',
    sourceFile: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/4. Booking Guidelines & Capacity.docx`,
    reviewStatus: 'needs_review',
    items: [
      ['Confirm current venue capacity', 'Check booking limits against licence, floorplan, and operating conditions.'],
      ['Confirm booking system rules', 'Review turns, large group rules, deposits, and cancellation handling.'],
      ['Confirm staff handover notes', 'Make sure booking notes flow into the daily briefing.']
    ]
  }
];

export const ALMA_COMPLIANCE_DOCUMENTS: ImportedComplianceDocument[] = [
  { title: 'Briefing St Alma', venue: 'St Alma', category: 'Handbook', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/Checklists and prodecures/Briefing St.Alma.docx`, notes: 'Briefing procedure. Review against current shift briefing flow.' },
  { title: 'Feed Me Menu Summer 2023', venue: 'St Alma', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/St Alma/Checklists and prodecures/Feed Me Menu Summer 2023.docx`, notes: 'Historic seasonal menu. Keep as reference only unless current menu matches.' },
  { title: 'St Alma FOH Close', venue: 'St Alma', category: 'Checklist', reviewStatus: 'active', sourcePath: `${dropboxRoot}/St Alma/Checklists and prodecures/St.Alma FOH Close .xlsx`, notes: 'Imported as active FOH closing checklist template.' },
  { title: 'St Alma FOH Open', venue: 'St Alma', category: 'Checklist', reviewStatus: 'active', sourcePath: `${dropboxRoot}/St Alma/Checklists and prodecures/St.Alma FOH Open.xlsx`, notes: 'Imported as active FOH opening checklist template.' },
  { title: 'St Alma Alcohol Plan of Management Appendix 9', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/APPENDIX 9 ALCOHOL PLAN OF MANAGEMENT_Final.pdf`, notes: 'Licence support document. Review against current conditions.' },
  { title: 'St Alma Licence Attachment Report', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/Licence Attachment Report Alma Freshwater.pdf`, notes: 'Licence attachment report for Freshwater.' },
  { title: 'St Alma LIQO660036418 Pro-rata invoice', venue: 'St Alma', category: 'Licensing', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/St Alma/licensing/LIQO660036418 - Pro-rata invoice.pdf`, notes: 'Historic invoice. Reference only.' },
  { title: 'St Alma Liquor Plan of Management DOCX', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/LIquor Plan of Management.docx`, notes: 'Editable plan of management source.' },
  { title: 'St Alma Liquor Plan of Management PDF', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/LIquor Plan of Management.pdf`, notes: 'PDF plan of management.' },
  { title: 'St Alma Notification 1-L94DQM6', venue: 'St Alma', category: 'Licensing', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/St Alma/licensing/Notification_1-L94DQM6.pdf`, notes: 'Historic licensing notification.' },
  { title: 'St Alma Notification 1-L94DQM8', venue: 'St Alma', category: 'Licensing', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/St Alma/licensing/Notification_1-L94DQM8 (1).pdf`, notes: 'Historic licensing notification.' },
  { title: 'St Alma NSW Police document 2021-114976', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/NSWPF-2021-114976.pdf`, notes: 'Licensing-related police document.' },
  { title: 'St Alma Plan at Grant', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/Plan at Grant - Alma Freshwater.pdf`, notes: 'Plan at grant for licence file.' },
  { title: 'St Alma Plan of Management', venue: 'St Alma', category: 'Licensing', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/St Alma/licensing/Plan of Management.pdf`, notes: 'Plan of management reference.' },
  { title: 'St Alma TDEC5 Declaration', venue: 'St Alma', category: 'Licensing', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/St Alma/licensing/tdec5-declaration-liquor-licence-application-by-proposed-licensee.pdf`, notes: 'Application/declaration record. Reference only.' },
  { title: 'Alma Avalon Winter List 2021', venue: 'Alma Avalon', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Bar/Alma Winter list 2021.pdf`, notes: 'Historic beverage list.' },
  { title: 'Alma Avalon Bar Induction Checklist', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Bar/Bar Induction Checklist.docx`, notes: 'Review before converting into Staff training.' },
  { title: 'Alma Avalon Bar Manual', venue: 'Alma Avalon', category: 'Handbook', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Bar/Bar Manuel UpdatePar.docx`, notes: 'Old bar manual. Review and refresh before active use.' },
  { title: 'Alma Avalon Bar Setup', venue: 'Alma Avalon', category: 'Checklist', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Bar/Bar setup.docx`, notes: 'Candidate bar setup checklist.' },
  { title: 'Alma Avalon Tequila and Mezcal 2021', venue: 'Alma Avalon', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Bar/May 2021 Tequila + Mezcal_3.pdf`, notes: 'Historic beverage training/menu reference.' },
  { title: 'Alma Avalon Wine and Beer Tasting Notes', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Bar/Tasting Notes Wine & Beer.docx`, notes: 'Likely historic training reference.' },
  { title: 'Alma Avalon 2020 Allergens Table', venue: 'Alma Avalon', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/2020 Allergens Table.xlsx`, notes: 'Historic allergen table; do not use as current allergen source.' },
  { title: 'Alma Avalon Definitions', venue: 'Alma Avalon', category: 'Handbook', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Definitions alma 2.docx`, notes: 'Old FOH reference.' },
  { title: 'Alma Avalon Definitions with menu items', venue: 'Alma Avalon', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Definitions with menu items .docx`, notes: 'Old menu reference.' },
  { title: 'Alma Avalon Feed Me', venue: 'Alma Avalon', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Feed Me .docx`, notes: 'Historic menu reference.' },
  { title: 'Alma Avalon FOH Close', venue: 'Alma Avalon', category: 'Checklist', reviewStatus: 'active', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/FOH Close .xlsx`, notes: 'Imported as active FOH closing checklist template.' },
  { title: 'Alma Avalon FOH Open', venue: 'Alma Avalon', category: 'Checklist', reviewStatus: 'active', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/FOH Open.xlsx`, notes: 'Imported as active FOH opening checklist template.' },
  { title: 'Alma Avalon Induction Checklist DOCX', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Induction checklist.docx`, notes: 'Review against Staff app onboarding before active use.' },
  { title: 'Alma Avalon Induction Checklist PDF', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Induction checklist.pdf`, notes: 'PDF version of induction checklist.' },
  { title: 'Alma Avalon SOS 2.0', venue: 'Alma Avalon', category: 'Handbook', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/SOS 2.0.docx`, notes: 'Review current operating relevance.' },
  { title: 'Alma Avalon Staff Induction Manual', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Staff Induction Manual.docx`, notes: 'Review and move useful parts into Staff onboarding/training.' },
  { title: 'Alma Avalon Summer 2022 Allergens', venue: 'Alma Avalon', category: 'Menu', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/FOH Completed/Summer 2022 allergens.xlsx`, notes: 'Historic allergen table; reference only.' },
  { title: 'Alma Avalon Kitchen Induction Checklist', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Kitchen Induction/Kitchen Induction Checklist.docx`, notes: 'Review before moving into Staff training.' },
  { title: 'Alma Avalon Kitchen Staff Induction Manual', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Kitchen Induction/Kitchen Staff Induction Manual.docx`, notes: 'Review before moving into Staff training.' },
  { title: 'Alma Avalon Employee Status', venue: 'Alma Avalon', category: 'Staff records', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Management Checklist/Employee Status.xlsx`, notes: 'Historic staff tracking sheet. Do not import as active staff data.' },
  { title: 'Alma Avalon Interview Questions', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Management Checklist/Interview Question.docx`, notes: 'Historic hiring reference.' },
  { title: 'Alma Avalon Manager New Employee Checklist', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Management Checklist/Manager New Employee Checklist.docx`, notes: 'Imported as a review checklist template.' },
  { title: 'Alma Avalon New Employee Questions', venue: 'Alma Avalon', category: 'Training', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Management Checklist/New Employee questions.docx`, notes: 'Historic onboarding reference.' },
  { title: 'Alma Avalon Cashing Up DOCX', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Cashing Up.docx`, notes: 'Review current till/cash process before active use.' },
  { title: 'Alma Avalon Cashing Up PDF', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Cashing Up.pdf`, notes: 'PDF version of cashing up procedure.' },
  { title: 'Alma Avalon Weekend List', venue: 'Alma Avalon', category: 'Checklist', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/Weekend List.docx`, notes: 'Historic weekend operations reference.' },
  { title: 'Alma Avalon SOP Contents', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/0. SOP CONTENTS PAGE.docx`, notes: 'Historic SOP index.' },
  { title: 'Alma Avalon Food Poisoning Allegation SOP', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/1. Food Poisioning Allegation.docx`, notes: 'Imported as a review checklist template.' },
  { title: 'Alma Avalon Guest Complaint SOP', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/2. Guest Complaint.docx`, notes: 'Imported as a review checklist template.' },
  { title: 'Alma Avalon WiFi Outage SOP', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/3. Wifi Outage.docx`, notes: 'Review current IT escalation contacts.' },
  { title: 'Alma Avalon Booking Guidelines and Capacity SOP', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/4. Booking Guidelines & Capacity.docx`, notes: 'Imported as a review checklist template.' },
  { title: 'Alma Avalon Incident Register and RSA Register SOP', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/Incident Register : RSA Register?.docx`, notes: 'Review and reconcile with Compliance incident/RSA records.' },
  { title: 'Alma Avalon SOP Template', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/SOP Template.docx`, notes: 'Historic SOP authoring template.' },
  { title: 'Alma Avalon SOPs', venue: 'Alma Avalon', category: 'SOP', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Introduction Folder SN/SOPs/SOPs.docx`, notes: 'Historic SOP bundle.' },
  { title: 'Alma Avalon Team', venue: 'Alma Avalon', category: 'Staff records', reviewStatus: 'archive', sourcePath: `${dropboxRoot}/Alma Avalon/Avalon Team .xlsx`, notes: 'Historic team/training sheet. Do not use as active staff data.' },
  { title: 'Alma Avalon Briefing Sheet Template', venue: 'Alma Avalon', category: 'Handbook', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/Briefing sheet template.docx`, notes: 'Review as possible current briefing template.' },
  { title: 'Alma Avalon RSA records', venue: 'Alma Avalon', category: 'Staff records', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/RSA records.xlsx`, notes: 'Review only. Staff app/compliance records should become source of truth.' },
  { title: 'Alma Avalon RSA tracking', venue: 'Alma Avalon', category: 'Staff records', reviewStatus: 'needs_review', sourcePath: `${dropboxRoot}/Alma Avalon/RSA.xlsx`, notes: 'Review only. Staff app/compliance records should become source of truth.' }
];
