/**
 * Handbook content defaults live here as the fallback bundle.
 *
 * The live handbook editor stores overrides in app settings. Pages merge those
 * overrides with this default content so the handbook stays editable in-app
 * without losing the source-of-truth structure when the JSON is partial.
 *
 * - `ORG_MEMBERS` feeds the Org Chart page. Each member has a `reportsTo` id
 *   that points at another member — the page renders the hierarchy from that.
 * - Set `reportsTo: null` for top-level members (usually the GM).
 * - Placeholder names are wrapped in square brackets so they're easy to spot
 *   and replace (e.g. "[Venue Manager - update in Admin]").
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
    id: 'general-manager',
    name: '[General Manager - update in Admin]',
    title: 'General Manager',
    reportsTo: null,
    responsibilities: [
      'Overall responsibility for service, compliance, and team decisions',
      'Final escalation point for serious incidents, safety issues, and venue readiness',
      'Keeps manager guidance current in Alma Admin'
    ]
  },
  {
    id: 'venue-manager',
    name: '[Venue Manager - update in Admin]',
    title: 'Venue Manager',
    reportsTo: 'general-manager',
    responsibilities: [
      'Runs day-to-day service across floor, bar, and kitchen',
      'Checks onboarding, documents, checklists, audits, and follow-up in Alma',
      'First escalation point for incidents, RSA concerns, and unsafe work'
    ]
  },
  {
    id: 'head-chef',
    name: '[Head Chef - update in Admin]',
    title: 'Head Chef',
    reportsTo: 'general-manager',
    responsibilities: [
      'Kitchen service, prep standards, food safety, and allergen handling',
      'Supplier and stock decisions with the manager where needed',
      'Reviews kitchen compliance actions before and after service'
    ]
  },
  {
    id: 'bar-manager',
    name: '[Bar Manager - update in Admin]',
    title: 'Bar Manager',
    reportsTo: 'venue-manager',
    responsibilities: [
      'Bar readiness, cellar standards, stock notes, and ordering signals',
      'RSA coaching and escalation during service',
      'Checks wastage, incidents, and handover notes in Alma where available'
    ]
  },
  {
    id: 'foh-lead',
    name: '[FOH Lead - update in Admin]',
    title: 'Front of House Lead',
    reportsTo: 'venue-manager',
    responsibilities: [
      'Floor setup, section standards, and service handover',
      'Supports new staff with handbook, checklist, and escalation steps',
      'Completes opening and closing checks before moving on'
    ]
  },
  {
    id: 'sous-chef',
    name: '[Sous Chef - update in Admin]',
    title: 'Sous Chef',
    reportsTo: 'head-chef',
    responsibilities: [
      "Kitchen leadership when the Head Chef is not on shift",
      'Prep lists, station setup, hygiene, and food safety checks',
      'Helps cooks follow current venue procedures'
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
      'Who to ask, who checks what, and how service questions should be escalated.',
    status: 'ready',
    href: '/handbook/org-chart'
  },
  {
    id: 'guidelines',
    title: 'Staff guidelines',
    summary:
      'Practical service guidance for RSA, difficult situations, allergens, records, and daily Alma use.',
    status: 'ready',
    href: '/handbook/guidelines'
  },
  {
    id: 'onboarding',
    title: 'New staff — getting started',
    summary:
      'What to read, what to upload, who to check in with, and how to start using Alma.',
    status: 'ready',
    href: '/handbook/onboarding'
  },
  {
    id: 'maintenance',
    title: 'Maintenance contacts',
    summary:
      'What to check first, when to stop service, and who to contact for urgent venue issues.',
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
    id: 'using-alma',
    category: 'Compliance',
    title: 'Using Alma during service',
    summary:
      'Use Alma to keep the next person informed. Read the handbook, complete the task, and record the issue while the details are still clear.',
    sections: [
      {
        heading: 'Before service',
        bullets: [
          'Read the handbook section that applies to the shift or task.',
          'Check assigned checklists, audits, and attention items in Compliance where available.',
          'Make sure required documents and staff compliance records are current in Alma Staff if the venue has enabled them.',
          'Ask a manager if something is unclear before service starts.'
        ]
      },
      {
        heading: 'During service',
        bullets: [
          'Complete checklists and audits in Alma when they are assigned. Complete the task before moving on.',
          'Record incidents, defects, temperature concerns, or maintenance issues in the current Alma area if enabled.',
          'Keep records accurate. Use Alma so the next person can see what happened.',
          'If something feels unsafe, stop and escalate it.'
        ]
      },
      {
        heading: 'Manager checks',
        bullets: [
          'Managers review onboarding, documents, checklists, audits, and follow-up before or after service.',
          'Managers approve, reject, or re-request documents where that workflow is enabled.',
          'Admin users keep handbook content, required documents, templates, integrations, permissions, and settings current through Admin.'
        ]
      },
      {
        heading: 'Where the other Alma apps fit',
        bullets: [
          'Reports shows action panels, attention items, readiness checks, and menu engineering where available.',
          'Gift Cards supports redeeming and order management for staff with that responsibility.',
          'Stock supports items, suppliers, recipes, production recipes, stocktakes, and cost checks for managers and stock users.',
          'Use only the apps and actions assigned to the role. Ask a manager before changing records outside normal duties.'
        ]
      }
    ],
    reminders: [
      'Use the current venue process when an Alma workflow is not enabled.',
      'Ask a manager if something is unclear.'
    ],
    lastUpdated: '2026-05-18'
  },
  {
    id: 'rsa',
    category: 'Customer service',
    title: 'Responsible Service of Alcohol (RSA)',
    summary:
      'The standard for serving alcohol calmly and safely. If in doubt, stop pouring and ask a manager.',
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
          "Don't argue or negotiate. If the patron pushes back, get a manager.",
          'Record the refusal as an incident or shift note where available.'
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
          "Keep an eye on the section - note who's drinking what and at what pace.",
          "Don't let an intoxicated patron buy drinks on behalf of someone else.",
          'Arrange safe transport for anyone who shouldn\'t be driving - offer to call a taxi or rideshare.',
          'Under 18s are never served, even if a parent is present and offering to buy for them.'
        ]
      }
    ],
    reminders: [
      'If in doubt, don\'t serve. Ask a manager.',
      'One refusal may be a shift note. Patterns need a clear incident record.'
    ],
    lastUpdated: '2026-05-18'
  },
  {
    id: 'difficult-customers',
    category: 'Customer service',
    title: 'Handling difficult or escalating situations',
    summary:
      'How to slow the moment down, protect staff and guests, and bring in a manager early.',
    sections: [
      {
        heading: 'De-escalation basics',
        bullets: [
          'Stay calm. Keep your voice low and steady.',
          'Give the person space. Do not crowd or block exits.',
          'Listen more than you speak. Acknowledge the complaint without agreeing to anything you can\'t deliver.',
          'Keep another staff member in sight if the conversation is tense.'
        ]
      },
      {
        heading: 'When to get a manager',
        bullets: [
          'Any time you\'ve refused service or asked someone to leave.',
          'If you feel physically unsafe or cornered.',
          'If another patron is being harassed.',
          'If the person is threatening damage, abuse, or disruption to the room.'
        ]
      },
      {
        heading: 'After the incident',
        bullets: [
          'Record the incident with time, people involved, and what was said.',
          'Check in with staff who were nearby.',
          'Flag it to the Venue Manager before the end of shift.'
        ]
      }
    ],
    reminders: [
      'If something feels unsafe, stop and escalate it.'
    ],
    lastUpdated: '2026-05-18'
  },
  {
    id: 'allergens',
    category: 'Compliance',
    title: 'Allergen awareness & handling',
    summary:
      'Food allergies can be fatal. Treat every allergen request as a safety task, not a preference.',
    sections: [
      {
        heading: 'Taking an allergen order',
        bullets: [
          'Repeat the allergen back to the guest and confirm which dish is affected.',
          'Write "ALLERGEN: [specific]" clearly on the POS ticket.',
          'Tell the kitchen directly — do not rely on the ticket alone.',
          'Never guess. If a dish may not be safe, ask the Head Chef.'
        ]
      },
      {
        heading: 'Serving the dish',
        bullets: [
          'Allergen dishes come up on a separate plate, clearly marked.',
          'Run the allergen plate yourself where possible. Do not hand off without a clear verbal handover.',
          'Reconfirm with the guest at the table.'
        ]
      },
      {
        heading: 'Record concerns',
        bullets: [
          'If an allergen error or near miss happens, stop service on the dish and tell a manager.',
          'Record the issue in Alma if incident or issue logging is enabled.'
        ]
      }
    ],
    reminders: [
      'If someone is having an allergic reaction, call 000 immediately — do not wait to see if it passes.'
    ],
    lastUpdated: '2026-05-18'
  },
  {
    id: 'medical-emergency',
    category: 'Emergency',
    title: 'Medical emergencies & first aid',
    summary:
      'What to do when a guest or staff member is injured, has a medical episode, or needs first aid.',
    sections: [
      {
        heading: 'Immediate steps',
        bullets: [
          'Call for the nearest First Aid qualified staff member. Check Alma Staff if available, or ask the manager on shift.',
          'Call 000 if the person is unconscious, bleeding heavily, struggling to breathe, or having a suspected cardiac event.',
          "Clear the area. Don't let a crowd form.",
          'Assign someone to wait at the door and flag down the ambulance.'
        ]
      },
      {
        heading: 'After the incident',
        bullets: [
          'Complete an incident report before the end of shift with times, what happened, what was done, and who was involved.',
          'Tell the Venue Manager immediately for serious incidents.',
          'Keep any CCTV intact — do not let the hard drive loop over the incident window.'
        ]
      }
    ],
    reminders: [
      'First aid kit is at [FIRST AID KIT LOCATION - update in Admin]. AED is at [AED LOCATION - update in Admin].'
    ],
    lastUpdated: '2026-05-18'
  },
  {
    id: 'daily-records',
    category: 'Compliance',
    title: 'Checklists, audits, and daily records',
    summary:
      'Daily records only help if they are complete, accurate, and easy for the next person to read.',
    sections: [
      {
        heading: 'Complete the task',
        bullets: [
          'Run opening, closing, cleaning, temperature, or safety checklists in Compliance where assigned.',
          'Do the check before marking it complete.',
          'Add a note or issue when something fails instead of ticking through it.',
          'Use photos only when they clearly show the issue and the venue process allows it.'
        ]
      },
      {
        heading: 'Audit follow-up',
        bullets: [
          'Managers review audit results and checklist exceptions before service where practical.',
          'If follow-up is assigned, complete it before moving on or ask a manager to reassign it.',
          'Use Reports attention items where available to check what still needs action.'
        ]
      },
      {
        heading: 'Keep records useful',
        bullets: [
          'Write short, factual notes: what happened, where, when, and what was done.',
          'Do not guess expiry dates, certificate details, or safety outcomes.',
          'Ask a manager if a record looks wrong.'
        ]
      }
    ],
    reminders: [
      'Keep records accurate.',
      'Use Alma so the next person can see what happened.'
    ],
    lastUpdated: '2026-05-18'
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
    title: 'Arrive early and check in',
    description:
      'Arrive before the shift starts and check in with the Venue Manager or shift lead. They will show the staff area, exits, first aid kit, and any service notes for the day.',
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
    title: 'Complete onboarding and upload documents',
    description:
      'Use the Alma onboarding link sent by a manager. Add the requested details and upload clear copies of required documents such as RSA, Food Safety Supervisor, First Aid, visa evidence, or role-specific certificates where required.',
    actions: [
      'Open the onboarding link on your phone',
      'Fill in contact details, emergency contact, and role information',
      'Upload clear document images or PDFs where the form allows it',
      'Check expiry dates before submitting',
      'Ask a manager for a new link if the link has expired'
    ],
    contact: 'Venue Manager',
    systems: ['Alma Staff', 'Alma onboarding']
  },
  {
    id: 'day-1-roster',
    phase: 'First day',
    title: 'Confirm roster and timekeeping process',
    description:
      'Managers will explain the current roster, clock-in, timesheet, and leave process. Use Alma Staff where available. If the venue uses another process, follow the manager\'s instructions.',
    actions: [
      'Confirm where the roster is published',
      'Check how to clock in and out',
      'Confirm how to request time off or update availability',
      'Ask before the first shift if access has not arrived'
    ],
    contact: 'Venue Manager',
    systems: ['Alma Staff where available', 'Current venue process']
  },
  {
    id: 'week-1-menu',
    phase: 'First week',
    title: 'Learn the menu and service standards',
    description:
      'Spend time with the Head Chef, Sous Chef, or shift lead. Learn key dishes, allergen handling, specials, table language, and what to do when unsure.',
    actions: [
      'Taste the top 5 most-ordered dishes',
      'Learn which dishes are gluten-free, vegan, and dairy-free by default',
      'Read the current specials and know when they change',
      'Ask what to recommend when a guest is unsure'
    ],
    contact: 'Head Chef'
  },
  {
    id: 'week-1-pos',
    phase: 'First week',
    title: 'Get comfortable with service systems',
    description:
      'The shift lead will walk through the POS and any Alma tasks used during the shift. Learn what to record, what to ask approval for, and when to escalate.',
    actions: [
      'Practice opening/closing a tab',
      'Practice a split bill',
      'Learn how to mark an allergen order (it flags the kitchen)',
      'Complete any assigned Alma checklist before moving on',
      'Watch a full cash-up if the role requires it'
    ],
    contact: 'Shift lead',
    systems: ['POS', 'Alma Compliance where available']
  },
  {
    id: 'week-1-rsa',
    phase: 'First week',
    title: 'Read core handbook guidance',
    description:
      'Read the staff handbook before working solo. Focus on RSA, allergens, incidents, checklists, audits, maintenance, and escalation.',
    actions: [
      'Read Handbook -> Guidelines -> Responsible Service of Alcohol',
      'Read the guidance on using Alma during service',
      'Shadow for a full shift',
      'Ask for feedback at the end of the shift'
    ],
    systems: ['Alma Compliance']
  },
  {
    id: 'month-1-compliance',
    phase: 'First month',
    title: 'Use Alma through a complete shift',
    description:
      'By the end of the first month, staff should be comfortable reading the handbook, completing assigned checklists, recording issues, and asking for help before guessing.',
    actions: [
      'Complete an opening or closing checklist where assigned',
      'Record temperature or audit checks where enabled',
      'Raise an issue for anything unsafe, broken, or unclear',
      'Use Reports attention items if a manager asks for a readiness check'
    ],
    systems: ['Alma Compliance']
  },
  {
    id: 'ongoing-certs',
    phase: 'Ongoing',
    title: 'Keep documents and records current',
    description:
      'Managers review staff documents in Alma Staff where available. Upload renewed certificates when asked, keep details accurate, and ask a manager if a record looks wrong.',
    actions: [
      'Upload renewed documents before the old copy expires',
      'Check that the document is readable before submitting',
      'Respond quickly if a manager re-requests a document',
      'Use the current venue process if Alma Staff is not enabled for the record'
    ],
    systems: ['Alma Staff']
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
      name: '[Venue Manager - update in Admin]',
      role: 'Manager on duty',
      phone: '[Phone - update in Admin]',
      availability: 'Call first during service.'
    },
    backup: {
      name: '[Licensed electrician - update in Admin]',
      role: 'Licensed electrician',
      phone: '[Phone - update in Admin]',
      availability: 'Emergency call-out where available.'
    },
    beforeYouCall: [
      'If something is smoking, sparking, hot, or unsafe, stop and clear the area.',
      'Check the main switchboard only if it is safe to do so.',
      'Record the time, area, and affected equipment in Alma or the current venue process.'
    ],
    notes:
      'Tag out faulty outlets or equipment so no one uses them until cleared by a manager or contractor.'
  },
  {
    id: 'plumbing',
    title: 'Plumbing',
    description:
      'Blocked drains, burst pipes, overflowing toilets, leaks, no hot water.',
    urgency: 'Same-day',
    primary: {
      name: '[Venue Manager - update in Admin]',
      role: 'Manager on duty',
      phone: '[Phone - update in Admin]'
    },
    backup: {
      name: '[Licensed plumber - update in Admin]',
      role: 'Licensed plumber',
      phone: '[Phone - update in Admin]',
      availability: 'After-hours call-out where available.'
    },
    beforeYouCall: [
      'If water is actively leaking or flooding, shut off the mains if trained and safe to do so.',
      'Put down wet-floor signs and mop up.',
      'Close off any affected bathroom or area to guests.',
      'Record the issue in Alma where available.'
    ]
  },
  {
    id: 'gas',
    title: 'Gas',
    description:
      'Gas smells, pilot lights out, cooktop or oven issues, hot water system.',
    urgency: 'Immediate',
    primary: {
      name: '[Licensed gas fitter - update in Admin]',
      role: 'Licensed gas fitter',
      phone: '[Phone - update in Admin]',
      availability: 'Same-day for safety issues.'
    },
    backup: {
      name: '[Venue Manager - update in Admin]',
      role: 'Manager on duty',
      phone: '[Phone - update in Admin]'
    },
    beforeYouCall: [
      'Smell gas? Turn off the main gas valve, ventilate the area, evacuate if strong, and CALL 000 FIRST.',
      'Do not use electrical switches, lighters, or phones near the leak.',
      'When safe, note what equipment or area is affected before calling the fitter.'
    ],
    notes:
      'For gas emergencies, call 000 first. Never try to relight a pilot light unless trained and approved.'
  },
  {
    id: 'refrigeration',
    title: 'Refrigeration & cool-rooms',
    description:
      'Fridges running warm, cool-room alarms, ice machines, freezer failures. Check temperature records where available before calling.',
    urgency: 'Same-day',
    primary: {
      name: '[Refrigeration technician - update in Admin]',
      role: 'Commercial refrigeration',
      phone: '[Phone - update in Admin]',
      availability: 'Same-day preferred when stock is at risk.'
    },
    backup: {
      name: '[Venue Manager - update in Admin]',
      role: 'Manager on duty',
      phone: '[Phone - update in Admin]'
    },
    beforeYouCall: [
      'Check Compliance temperature records if enabled.',
      'If the unit is failing, move high-risk stock to a working unit if safe and approved by a manager.',
      'Record the asset, temperature, time noticed, and action taken.'
    ]
  },
  {
    id: 'hvac',
    title: 'Air conditioning / ventilation',
    description: 'Climate control, exhaust fans, kitchen ventilation.',
    urgency: 'Routine',
    primary: {
      name: '[HVAC contractor - update in Admin]',
      role: 'HVAC / mechanical services',
      phone: '[Phone - update in Admin]',
      availability: 'Book ahead where practical.'
    },
    backup: {
      name: '[Venue Manager - update in Admin]',
      role: 'Manager on duty',
      phone: '[Phone - update in Admin]'
    },
    beforeYouCall: [
      'Check the thermostat or remote is set correctly.',
      'Check filters only if access is safe and approved.',
      'Record how long it has been acting up and which zones are affected.'
    ]
  },
  {
    id: 'general',
    title: 'General repairs',
    description:
      'Furniture, doors, locks, glazing, signage, small bits and pieces that don\'t fit the categories above.',
    urgency: 'Routine',
    primary: {
      name: '[Venue Manager - update in Admin]',
      role: 'Manager on duty',
      phone: '[Phone - update in Admin]'
    },
    backup: {
      name: '[General maintenance contractor - update in Admin]',
      role: 'General maintenance',
      phone: '[Phone - update in Admin]'
    },
    beforeYouCall: [
      'Make the area safe first.',
      'Take a clear note or photo if the venue process allows it.',
      'Record the issue in Alma where available so follow-up is visible.'
    ]
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
