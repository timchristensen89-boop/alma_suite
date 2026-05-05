/**
 * Handbook content defaults live here as the fallback bundle.
 *
 * The live handbook editor stores overrides in app settings. Pages merge those
 * overrides with this default content so the handbook stays editable in-app
 * without losing the source-of-truth structure when the JSON is partial.
 *
 * - `ORG_MEMBERS` feeds the Org Chart page. Each member has a `reportsTo` id
 *   that points at another member — the page renders the hierarchy from that.
 * - Set `reportsTo: null` for top-level members (usually the owner / GM).
 * - Placeholder names are wrapped in square brackets so they're easy to spot
 *   and replace (e.g. "[Venue Manager — TBD]").
 */

export type OrgMember = {
  id: string;
  name: string;
  title: string;
  reportsTo: string | null;
  responsibilities: string[];
  email?: string;
  phone?: string;
  /** Optional venue/location shown as a small label on the card. */
  venue?: string;
};

export const ORG_MEMBERS: OrgMember[] = [
  {
    id: 'owner',
    name: 'Tim Christensen',
    title: 'Owner / General Manager',
    reportsTo: null,
    responsibilities: [
      'Overall responsibility for venue operations, compliance, and finance',
      'Sign-off on major spend and staffing decisions',
      'Primary contact for maintenance and escalations'
    ],
    email: 'timchristensen89@gmail.com'
  },
  {
    id: 'venue-manager',
    name: '[Venue Manager — TBD]',
    title: 'Venue Manager',
    reportsTo: 'owner',
    responsibilities: [
      'Day-to-day operations across bar, floor, and kitchen',
      'Staff rostering via Deputy',
      'First escalation point for customer incidents and RSA concerns'
    ]
  },
  {
    id: 'head-chef',
    name: '[Head Chef — TBD]',
    title: 'Head Chef',
    reportsTo: 'owner',
    responsibilities: [
      'Kitchen operations, menus, and food safety',
      'Supplier relationships and stock ordering',
      'Allergen and HACCP compliance'
    ]
  },
  {
    id: 'bar-manager',
    name: '[Bar Manager — TBD]',
    title: 'Bar Manager',
    reportsTo: 'venue-manager',
    responsibilities: [
      'Bar stock, cellar, and ordering',
      'RSA training and compliance on bar staff',
      'Daily pour-cost and wastage checks'
    ]
  },
  {
    id: 'foh-lead',
    name: '[FOH Lead — TBD]',
    title: 'Front of House Lead',
    reportsTo: 'venue-manager',
    responsibilities: [
      'Floor staff supervision and training',
      'Customer service standards',
      'Opening and closing checklists'
    ]
  },
  {
    id: 'sous-chef',
    name: '[Sous Chef — TBD]',
    title: 'Sous Chef',
    reportsTo: 'head-chef',
    responsibilities: [
      "Kitchen leadership in Head Chef's absence",
      'Prep lists and kitchen hygiene',
      'Station training for cooks'
    ]
  }
];

export type HandbookContent = Partial<{
  orgMembers: OrgMember[];
  handbookSections: HandbookSection[];
  guidelines: Guideline[];
  onboardingSteps: OnboardingStep[];
  maintenanceCategories: MaintenanceCategory[];
}>;

export type HandbookSection = {
  id: string;
  title: string;
  summary: string;
  status: 'ready' | 'coming-soon';
  href: string;
};

export const HANDBOOK_SECTIONS: HandbookSection[] = [
  {
    id: 'org-chart',
    title: 'Org chart & responsibilities',
    summary:
      'Who manages what. The venue hierarchy, roles, and what each person is on the hook for.',
    status: 'ready',
    href: '/handbook/org-chart'
  },
  {
    id: 'guidelines',
    title: 'Staff guidelines',
    summary:
      'Customer-facing guidelines — RSA, handling difficult situations, refusal of service, intoxication, and more.',
    status: 'ready',
    href: '/handbook/guidelines'
  },
  {
    id: 'onboarding',
    title: 'New staff — getting started',
    summary:
      'First day / first week procedure. Who to talk to, where to go, how to use Deputy and the compliance app.',
    status: 'ready',
    href: '/handbook/onboarding'
  },
  {
    id: 'maintenance',
    title: 'Maintenance contacts',
    summary:
      'Who to call when something breaks — electrical, plumbing, gas, refrigeration — with a backup contact if the primary is unavailable.',
    status: 'ready',
    href: '/handbook/maintenance'
  }
];

/* --------------------------------------------------------------------------
 * Staff guidelines
 * ------------------------------------------------------------------------ */

export type GuidelineCategory =
  | 'Customer service'
  | 'Compliance'
  | 'Emergency'
  | 'Other';

export type GuidelineSection = {
  heading: string;
  bullets: string[];
};

export type Guideline = {
  id: string;
  category: GuidelineCategory;
  title: string;
  summary: string;
  sections: GuidelineSection[];
  /** Short one-liners shown as pull-quote reminders below the sections. */
  reminders?: string[];
  lastUpdated?: string;
};

export const GUIDELINES: Guideline[] = [
  {
    id: 'rsa',
    category: 'Customer service',
    title: 'Responsible Service of Alcohol (RSA)',
    summary:
      'The legal and venue-wide standard for serving alcohol. Everyone on the floor is responsible. If in doubt, stop pouring and ask a manager.',
    sections: [
      {
        heading: 'Spot the signs of intoxication',
        bullets: [
          'Slurred, loud, or incoherent speech',
          'Impaired coordination — bumping into things, fumbling cards or glasses',
          'Drowsy, confused, or withdrawn behaviour',
          'Aggressive, argumentative, or overly familiar behaviour',
          'Red or glassy eyes, flushed face, smell of alcohol on breath'
        ]
      },
      {
        heading: 'Refusing service',
        bullets: [
          'Be polite, calm, and firm. Use "I" statements ("I can\'t serve you another one tonight").',
          'Offer water, food, and a non-alcoholic alternative.',
          "Don't argue or negotiate. If the patron pushes back, get a manager — do not handle it alone.",
          'Log the refusal in the incidents page so we have a record.'
        ]
      },
      {
        heading: 'Checking ID',
        bullets: [
          'Ask for ID from anyone who looks under 25.',
          'Only accept: AU driver\'s licence, Australian or foreign passport, Proof of Age card, or Keypass.',
          'Never accept photocopies, digital screenshots, or expired IDs.',
          'Match the face on the ID to the person in front of you. If in doubt, refuse.'
        ]
      },
      {
        heading: 'Duty of care',
        bullets: [
          "Keep an eye on your section — note who's drinking what and at what pace.",
          "Don't let an intoxicated patron buy drinks on behalf of someone else.",
          'Arrange safe transport for anyone who shouldn\'t be driving — offer to call a taxi or rideshare.',
          'Under 18s are never served, even if a parent is present and offering to buy for them.'
        ]
      }
    ],
    reminders: [
      'If in doubt, don\'t serve. Ask a manager.',
      'One refusal is a shift note. Patterns are an incident report.'
    ],
    lastUpdated: '2026-04-22'
  },
  {
    id: 'difficult-customers',
    category: 'Customer service',
    title: 'Handling difficult or escalating situations',
    summary:
      'The steps to de-escalate, protect yourself and other patrons, and get a manager involved without making the situation worse.',
    sections: [
      {
        heading: 'De-escalation basics',
        bullets: [
          'Stay calm. Keep your voice low and steady.',
          'Give the person space — don\'t crowd or block exits.',
          'Listen more than you speak. Acknowledge the complaint without agreeing to anything you can\'t deliver.',
          "Don't take it personally. Most escalation isn't about you."
        ]
      },
      {
        heading: 'When to get a manager',
        bullets: [
          'Any time you\'ve refused service or asked someone to leave.',
          'If you feel physically unsafe or cornered.',
          'If another patron is being harassed.',
          'If the person is threatening property damage or a scene that will affect the room.'
        ]
      },
      {
        heading: 'After the incident',
        bullets: [
          'Log it as an incident report with time, people involved, and what was said.',
          'Check in with anyone else on your team who was nearby.',
          'Flag to the Venue Manager before the end of shift.'
        ]
      }
    ],
    reminders: [
      'Your safety comes first. Nothing on the floor is worth a punch.'
    ]
  },
  {
    id: 'allergens',
    category: 'Compliance',
    title: 'Allergen awareness & handling',
    summary:
      'Food allergies can be fatal. Everyone on the floor and in the kitchen needs to treat allergen requests seriously.',
    sections: [
      {
        heading: 'Taking an allergen order',
        bullets: [
          'Repeat the allergen back to the guest and confirm which dish is affected.',
          'Write "ALLERGEN: [specific]" clearly on the POS ticket.',
          'Tell the kitchen directly — do not rely on the ticket alone.',
          'Never guess. If you\'re not certain a dish is safe, ask the Head Chef.'
        ]
      },
      {
        heading: 'Serving the dish',
        bullets: [
          'Allergen dishes come up on a separate plate, clearly marked.',
          'Run the allergen plate yourself — don\'t hand off to another staff member.',
          'Reconfirm with the guest at the pass ("This is the gluten-free X, correct?").'
        ]
      }
    ],
    reminders: [
      'If someone is having an allergic reaction, call 000 immediately — do not wait to see if it passes.'
    ]
  },
  {
    id: 'medical-emergency',
    category: 'Emergency',
    title: 'Medical emergencies & first aid',
    summary:
      'What to do when a customer or staff member is injured, has a medical episode, or needs first aid.',
    sections: [
      {
        heading: 'Immediate steps',
        bullets: [
          'Call for the nearest First Aid qualified staff member — check the Staff page if you\'re not sure who\'s on.',
          'Call 000 if the person is unconscious, bleeding heavily, struggling to breathe, or having a suspected cardiac event.',
          "Clear the area — don't let a crowd form.",
          'Assign someone to wait at the door and flag down the ambulance.'
        ]
      },
      {
        heading: 'After the incident',
        bullets: [
          'Log a full incident report before the end of shift — times, what happened, what was done, who was involved.',
          'Flag to the Venue Manager or on-call owner immediately for serious incidents.',
          'Keep any CCTV intact — do not let the hard drive loop over the incident window.'
        ]
      }
    ],
    reminders: [
      'First aid kit is at the pass. AED is [LOCATION — update in data file].'
    ]
  }
];

/* --------------------------------------------------------------------------
 * New staff onboarding procedure
 * ------------------------------------------------------------------------ */

export type OnboardingPhase = 'First day' | 'First week' | 'First month' | 'Ongoing';

export type OnboardingStep = {
  id: string;
  phase: OnboardingPhase;
  title: string;
  description: string;
  actions?: string[];
  contact?: string;
  systems?: string[];
};

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'day-1-arrival',
    phase: 'First day',
    title: 'Arrive, meet the team, and do the walk-through',
    description:
      'When you arrive for your first shift, check in with the Venue Manager (or whoever is shift-leading). They\'ll walk you through the venue, show you the staff area, fire exits, and first-aid kit.',
    actions: [
      'Arrive 15 minutes before your rostered start time',
      'Check in with the shift lead',
      'Get shown the staff area, toilets, and fire exits',
      'Find out where the First Aid kit and AED are'
    ],
    contact: 'Venue Manager'
  },
  {
    id: 'day-1-paperwork',
    phase: 'First day',
    title: 'Submit your onboarding details & certificates',
    description:
      'Use the Alma Compliance onboarding link the manager sent you (or ask for a fresh one). Fill in your details and upload photos of your RSA, FSS, First Aid, and any other relevant certificates.',
    actions: [
      'Open the onboarding link on your phone',
      'Fill in name, role, emergency contact',
      'Upload clear photos of the front of each certificate',
      'Double-check expiry dates before submitting'
    ],
    contact: 'Venue Manager',
    systems: ['Alma Compliance']
  },
  {
    id: 'day-1-deputy',
    phase: 'First day',
    title: 'Set up Deputy for rostering',
    description:
      'Deputy is how we roster shifts, clock in and out, and request time off. The Venue Manager will invite you — accept the invite on your phone, set your availability, and clock in at the start of your next shift.',
    actions: [
      'Accept the Deputy invite (check your email)',
      'Install the Deputy app and log in',
      'Set your standing availability',
      'Practice clocking in and out before the shift starts'
    ],
    contact: 'Venue Manager',
    systems: ['Deputy']
  },
  {
    id: 'week-1-menu',
    phase: 'First week',
    title: 'Learn the menu, top-sellers, and specials',
    description:
      'Sit down with the Head Chef or Sous Chef and taste the main menu items. Know the top-sellers, the allergen-safe options, and what\'s on current special.',
    actions: [
      'Taste the top 5 most-ordered dishes',
      'Learn which dishes are gluten-free, vegan, and dairy-free by default',
      'Read the current specials and know when they change',
      'Ask: "if a guest asks for X, what do we recommend?"'
    ],
    contact: 'Head Chef'
  },
  {
    id: 'week-1-pos',
    phase: 'First week',
    title: 'Get comfortable on the POS',
    description:
      'Your shift lead will walk you through the POS — splitting bills, allergen flags, voids, and end-of-shift cash-up.',
    actions: [
      'Practice opening/closing a tab',
      'Practice a split bill',
      'Learn how to mark an allergen order (it flags the kitchen)',
      'Watch a full cash-up'
    ],
    contact: 'Shift lead'
  },
  {
    id: 'week-1-rsa',
    phase: 'First week',
    title: 'Read the RSA guideline and complete your induction shift',
    description:
      'Even if your RSA is current, read the venue RSA guideline in the Handbook. Shadow an experienced floor member for a full shift before working solo.',
    actions: [
      'Read Handbook → Guidelines → Responsible Service of Alcohol',
      'Shadow for a full shift',
      'Ask for feedback at the end'
    ],
    systems: ['Alma Compliance']
  },
  {
    id: 'month-1-compliance',
    phase: 'First month',
    title: 'Run a full shift using all compliance tools',
    description:
      'By the end of your first month you should be running opening or closing checklists, logging temps if required, and flagging any issues through the compliance app.',
    actions: [
      'Complete an opening or closing checklist solo',
      'Log at least one temperature check (where relevant)',
      'Raise any issue you find via the Issues page'
    ],
    systems: ['Alma Compliance']
  },
  {
    id: 'ongoing-certs',
    phase: 'Ongoing',
    title: 'Keep your certificates up to date',
    description:
      'The Staff page shows expiring certificates. We\'ll give you 30-day notice before an expiry, but it\'s your responsibility to book the renewal. Upload the new certificate through the compliance app.',
    systems: ['Alma Compliance']
  }
];

/* --------------------------------------------------------------------------
 * Maintenance contacts
 * ------------------------------------------------------------------------ */

export type MaintenanceContact = {
  name: string;
  role: string;
  phone?: string;
  email?: string;
  availability?: string;
  notes?: string;
};

export type MaintenanceCategory = {
  id: string;
  title: string;
  description: string;
  urgency: 'Routine' | 'Same-day' | 'Immediate';
  primary: MaintenanceContact;
  backup?: MaintenanceContact;
  /** Things staff should check / try before calling. */
  beforeYouCall?: string[];
  notes?: string;
};

export const MAINTENANCE_CATEGORIES: MaintenanceCategory[] = [
  {
    id: 'electrical',
    title: 'Electrical',
    description:
      'Power outages, tripped circuits, faulty outlets, flickering lights, anything smoking or sparking.',
    urgency: 'Immediate',
    primary: {
      name: 'Tim Christensen',
      role: 'Owner / first call',
      phone: '[Tim\'s mobile — update in data file]',
      email: 'timchristensen89@gmail.com',
      availability: 'Usually reachable. Leave a voicemail if no answer.'
    },
    backup: {
      name: '[Backup electrician — TBD]',
      role: 'Licensed electrician',
      phone: '[Phone — TBD]',
      availability: 'Emergency call-out available 24/7 — mention the venue name.'
    },
    beforeYouCall: [
      'Check the main switchboard — flip any tripped breaker back on.',
      'If something is smoking or sparking, cut power at the board and evacuate the area first.',
      'Note the time the issue started and which circuit / appliance is affected.'
    ],
    notes:
      'Tag out any faulty outlet or appliance so no one plugs into it until it\'s been checked.'
  },
  {
    id: 'plumbing',
    title: 'Plumbing',
    description:
      'Blocked drains, burst pipes, overflowing toilets, leaks, no hot water.',
    urgency: 'Same-day',
    primary: {
      name: 'Tim Christensen',
      role: 'Owner / first call',
      phone: '[Tim\'s mobile — update in data file]',
      email: 'timchristensen89@gmail.com'
    },
    backup: {
      name: '[Backup plumber — TBD]',
      role: 'Licensed plumber',
      phone: '[Phone — TBD]',
      availability: 'After-hours surcharge applies for emergency call-outs.'
    },
    beforeYouCall: [
      'If water is actively leaking or flooding, shut off the mains (main tap is in the [LOCATION] — update in data file).',
      'Put down wet-floor signs and mop up.',
      'Close off any affected bathroom/area to customers.'
    ]
  },
  {
    id: 'gas',
    title: 'Gas',
    description:
      'Gas smells, pilot lights out, cooktop or oven issues, hot water system.',
    urgency: 'Immediate',
    primary: {
      name: '[Gas fitter — TBD]',
      role: 'Licensed gas fitter',
      phone: '[Phone — TBD]',
      availability: 'Same-day for safety issues.'
    },
    backup: {
      name: 'Tim Christensen',
      role: 'Owner',
      phone: '[Tim\'s mobile — update in data file]',
      email: 'timchristensen89@gmail.com'
    },
    beforeYouCall: [
      'Smell gas? Turn off the main gas valve, ventilate the area, evacuate if strong, and CALL 000 FIRST.',
      'Do not use electrical switches, lighters, or phones near the leak.',
      'Note what equipment / area is affected before calling the fitter.'
    ],
    notes:
      'For gas emergencies, 000 first, then call us. Never try to re-light a pilot light yourself.'
  },
  {
    id: 'refrigeration',
    title: 'Refrigeration & cool-rooms',
    description:
      'Fridges running warm, cool-room alarms, ice machines, freezer failures. Check the Temperatures page for the live reading before calling.',
    urgency: 'Same-day',
    primary: {
      name: '[Refrigeration tech — TBD]',
      role: 'Commercial refrigeration',
      phone: '[Phone — TBD]',
      availability: 'Same-day preferred — stock is at risk.'
    },
    backup: {
      name: 'Tim Christensen',
      role: 'Owner',
      phone: '[Tim\'s mobile — update in data file]',
      email: 'timchristensen89@gmail.com'
    },
    beforeYouCall: [
      'Check the Temperatures page — is this actually out of range, or just a door that was left open?',
      'If genuinely failing, move critical stock (meat, dairy) to a working unit immediately.',
      'Note the asset and the temperature when you noticed.'
    ]
  },
  {
    id: 'hvac',
    title: 'Air conditioning / ventilation',
    description: 'Climate control, exhaust fans, kitchen ventilation.',
    urgency: 'Routine',
    primary: {
      name: '[HVAC contractor — TBD]',
      role: 'HVAC / mechanical services',
      phone: '[Phone — TBD]',
      availability: 'Book ahead — not usually same-day.'
    },
    backup: {
      name: 'Tim Christensen',
      role: 'Owner',
      phone: '[Tim\'s mobile — update in data file]',
      email: 'timchristensen89@gmail.com'
    },
    beforeYouCall: [
      'Check the thermostat / remote is set correctly.',
      'Check filters aren\'t obviously clogged.',
      'Note how long it\'s been acting up and which zones are affected.'
    ]
  },
  {
    id: 'general',
    title: 'General repairs',
    description:
      'Furniture, doors, locks, glazing, signage, small bits and pieces that don\'t fit the categories above.',
    urgency: 'Routine',
    primary: {
      name: 'Tim Christensen',
      role: 'Owner',
      phone: '[Tim\'s mobile — update in data file]',
      email: 'timchristensen89@gmail.com'
    },
    backup: {
      name: '[Handyman — TBD]',
      role: 'General maintenance',
      phone: '[Phone — TBD]'
    }
  }
];

export const DEFAULT_HANDBOOK_CONTENT: HandbookContent = {
  orgMembers: ORG_MEMBERS,
  handbookSections: HANDBOOK_SECTIONS,
  guidelines: GUIDELINES,
  onboardingSteps: ONBOARDING_STEPS,
  maintenanceCategories: MAINTENANCE_CATEGORIES
};

function asArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}

export function resolveHandbookContent(content: unknown): Required<HandbookContent> {
  const source = content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
  return {
    orgMembers: asArray<OrgMember>(source.orgMembers) ?? ORG_MEMBERS,
    handbookSections: asArray<HandbookSection>(source.handbookSections) ?? HANDBOOK_SECTIONS,
    guidelines: asArray<Guideline>(source.guidelines) ?? GUIDELINES,
    onboardingSteps: asArray<OnboardingStep>(source.onboardingSteps) ?? ONBOARDING_STEPS,
    maintenanceCategories: asArray<MaintenanceCategory>(source.maintenanceCategories) ?? MAINTENANCE_CATEGORIES
  };
}
