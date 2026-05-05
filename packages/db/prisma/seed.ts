import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';

async function reset() {
  await prisma.appSettings.deleteMany();
  await prisma.staffInvite.deleteMany();
  await prisma.temperatureLog.deleteMany();
  await prisma.temperatureAsset.deleteMany();
  await prisma.incidentPerson.deleteMany();
  await prisma.incidentReport.deleteMany();
  await prisma.staffComplianceRecord.deleteMany();
  await prisma.staffProfile.deleteMany();
  await prisma.auditFinding.deleteMany();
  await prisma.auditRun.deleteMany();
  await prisma.auditTemplateSection.deleteMany();
  await prisma.auditTemplate.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklistRun.deleteMany();
  await prisma.checklistItemTemplate.deleteMany();
  await prisma.checklistTemplate.deleteMany();
  await prisma.issueActivity.deleteMany();
  await prisma.issueEvidence.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.liquorLicence.deleteMany();
}

async function seedIssues() {
  const baseDate = new Date();
  const issueInputs = [
    {
      title: 'Hand wash station soap dispenser empty',
      description: 'Soap dispenser at prep area hand wash station was empty during open.',
      severity: 'HIGH',
      category: 'Food Safety',
      status: 'OPEN',
      assignee: 'Venue Manager',
      dueDateOffsetDays: 1,
      notes: 'Second time this week. Refill checks need tightening.',
      evidence: [{ name: 'Prep sink photo', url: 'https://example.com/evidence/prep-sink', fileType: 'image' }],
      activities: [
        { action: 'created', message: 'Issue raised from opening checks.', actor: 'system' },
        { action: 'reviewed', message: 'Manager confirmed soap cartridges were out of stock.', actor: 'Venue Manager' }
      ]
    },
    {
      title: 'Back dock fire exit partially obstructed',
      description: 'Beverage kegs left in front of the rear fire exit reduced safe egress width.',
      severity: 'CRITICAL',
      category: 'Safety',
      status: 'IN_PROGRESS',
      assignee: 'Operations Lead',
      dueDateOffsetDays: 0,
      notes: 'Area cleared temporarily, storage map needs update.',
      evidence: [{ name: 'Back dock obstruction', url: 'https://example.com/evidence/fire-exit', fileType: 'image' }],
      activities: [
        { action: 'created', message: 'Issue raised from walk through.', actor: 'system' },
        { action: 'assigned', message: 'Assigned to Operations Lead for immediate action.', actor: 'system' }
      ]
    },
    {
      title: 'Cool room temperature log missing for Friday close',
      description: 'The close checklist has no cool room entry for Friday night.',
      severity: 'MEDIUM',
      category: 'Records',
      status: 'BLOCKED',
      assignee: 'Closing Supervisor',
      dueDateOffsetDays: 2,
      notes: 'Need to confirm whether log was paper based and not uploaded.',
      evidence: [],
      activities: [{ action: 'created', message: 'Gap found during weekly compliance review.', actor: 'system' }]
    },
    {
      title: 'Chemical bottles missing secondary labels',
      description: 'Three decanted cleaning bottles in the dish area are unlabeled.',
      severity: 'HIGH',
      category: 'Chemical Safety',
      status: 'RESOLVED',
      assignee: 'Head Chef',
      dueDateOffsetDays: -1,
      notes: 'Retraining completed with kitchen team.',
      resolutionNotes: 'All bottles relabeled and chemical decanting procedure reissued.',
      evidence: [{ name: 'Relabeled bottles', url: 'https://example.com/evidence/labels', fileType: 'image' }],
      activities: [
        { action: 'created', message: 'Issue raised from audit.', actor: 'system' },
        { action: 'resolved', message: 'Labels applied and toolbox talk completed.', actor: 'Head Chef' }
      ]
    },
    {
      title: 'First aid kit restock incomplete',
      description: 'Bandage stock below minimum in upstairs first aid kit.',
      severity: 'LOW',
      category: 'Safety',
      status: 'CLOSED',
      assignee: 'Duty Manager',
      dueDateOffsetDays: -3,
      notes: 'Restocked from central store.',
      resolutionNotes: 'Closed after stock count confirmed against checklist.',
      evidence: [],
      activities: [
        { action: 'created', message: 'Issue opened from weekly safety check.', actor: 'system' },
        { action: 'closed', message: 'Restock verified and issue closed.', actor: 'Duty Manager' }
      ]
    },
    {
      title: 'Supplier allergen spec sheet outdated',
      description: 'Latest allergen declaration for corn tortillas has not been filed.',
      severity: 'MEDIUM',
      category: 'Allergen',
      status: 'OPEN',
      assignee: 'Admin',
      dueDateOffsetDays: 4,
      notes: 'Waiting on supplier response.',
      evidence: [],
      activities: [{ action: 'created', message: 'Issue created during records review.', actor: 'system' }]
    },
    {
      title: 'Glass washer rinse aid alert active',
      description: 'Bar glass washer showing rinse aid low alert during service.',
      severity: 'MEDIUM',
      category: 'Equipment',
      status: 'IN_PROGRESS',
      assignee: 'Bar Manager',
      dueDateOffsetDays: 1,
      notes: 'Temporary top up done. Check auto feed line.',
      evidence: [{ name: 'Machine panel', url: 'https://example.com/evidence/rinse-aid', fileType: 'image' }],
      activities: [{ action: 'created', message: 'Logged from service interruption.', actor: 'system' }]
    },
    {
      title: 'Knife rack mounting loose',
      description: 'Magnetic knife rack at prep bench has movement on right anchor point.',
      severity: 'HIGH',
      category: 'Maintenance',
      status: 'OPEN',
      assignee: 'Maintenance',
      dueDateOffsetDays: 2,
      notes: 'Potential drop hazard.',
      evidence: [],
      activities: [{ action: 'created', message: 'Reported by kitchen staff.', actor: 'system' }]
    },
    {
      title: 'Waste oil collection docket missing signature',
      description: 'Last collection sheet filed without receiver sign off.',
      severity: 'LOW',
      category: 'Records',
      status: 'OPEN',
      assignee: 'Admin',
      dueDateOffsetDays: 5,
      notes: 'Need replacement copy from contractor.',
      evidence: [],
      activities: [{ action: 'created', message: 'Found during records spot check.', actor: 'system' }]
    },
    {
      title: 'Rear prep floor tiles slippery after mop down',
      description: 'Floor remains slippery beyond acceptable dry time after close clean.',
      severity: 'HIGH',
      category: 'Safety',
      status: 'BLOCKED',
      assignee: 'Cleaning Lead',
      dueDateOffsetDays: 2,
      notes: 'Need alternate chemical or dilution review.',
      evidence: [],
      activities: [{ action: 'created', message: 'Raised from near miss discussion.', actor: 'system' }]
    },
    {
      title: 'Pest control bait map not updated',
      description: 'Latest bait station move has not been reflected in the site map.',
      severity: 'MEDIUM',
      category: 'Pest Control',
      status: 'RESOLVED',
      assignee: 'Venue Manager',
      dueDateOffsetDays: -2,
      notes: 'Updated PDF stored in shared folder.',
      resolutionNotes: 'Map updated and printed copy replaced in compliance folder.',
      evidence: [],
      activities: [{ action: 'created', message: 'Audit follow up opened.', actor: 'system' }]
    },
    {
      title: 'Emergency contact poster out of date',
      description: 'Poster near office still references old after hours manager number.',
      severity: 'LOW',
      category: 'Safety',
      status: 'OPEN',
      assignee: 'Admin',
      dueDateOffsetDays: 6,
      notes: 'New print ready but not yet installed.',
      evidence: [],
      activities: [{ action: 'created', message: 'Admin review raised issue.', actor: 'system' }]
    }
  ] as const;

  const createdIssues = [] as { id: string; title: string }[];

  for (const issueInput of issueInputs) {
    const issue = await prisma.issue.create({
      data: {
        title: issueInput.title,
        description: issueInput.description,
        severity: issueInput.severity,
        category: issueInput.category,
        status: issueInput.status,
        assignee: issueInput.assignee,
        dueDate: new Date(baseDate.getTime() + issueInput.dueDateOffsetDays * 24 * 60 * 60 * 1000),
        notes: issueInput.notes,
        resolutionNotes: issueInput.resolutionNotes,
        evidence: issueInput.evidence.length
          ? {
              create: issueInput.evidence.map((evidence) => ({
                name: evidence.name,
                url: evidence.url,
                fileType: evidence.fileType
              }))
            }
          : undefined,
        activities: {
          create: issueInput.activities.map((activity) => ({
            action: activity.action,
            message: activity.message,
            actor: activity.actor
          }))
        }
      }
    });

    createdIssues.push({ id: issue.id, title: issue.title });
  }

  return createdIssues;
}

async function seedChecklists(issueIds: { id: string; title: string }[]) {
  const openingTemplate = await prisma.checklistTemplate.create({
    data: {
      name: 'Opening Safety Check',
      area: 'Venue Wide',
      items: {
        create: [
          { label: 'Fire exits clear', description: 'Check all emergency exits and paths.', position: 1 },
          { label: 'Hand wash stations stocked', description: 'Soap, towels, signage in place.', position: 2 },
          { label: 'First aid kit present', description: 'Kit stocked and accessible.', position: 3 },
          { label: 'Cool room temperature logged', description: 'Record temperature before service.', position: 4 }
        ]
      }
    },
    include: { items: { orderBy: { position: 'asc' } } }
  });

  const closeTemplate = await prisma.checklistTemplate.create({
    data: {
      name: 'Close Clean Down',
      area: 'Kitchen',
      items: {
        create: [
          { label: 'Chemical bottles labeled', description: 'All decanted bottles labeled correctly.', position: 1 },
          { label: 'Waste removed', description: 'Waste area secure and bins closed.', position: 2 },
          { label: 'Floors safe after mop', description: 'No slipping risk remains.', position: 3 },
          { label: 'All logs completed', description: 'Temperature and cleaning logs complete.', position: 4 }
        ]
      }
    },
    include: { items: { orderBy: { position: 'asc' } } }
  });

  const barTemplate = await prisma.checklistTemplate.create({
    data: {
      name: 'Bar Equipment Check',
      area: 'Bar',
      items: {
        create: [
          { label: 'Glass washer chemicals topped up', description: 'Confirm rinse aid and detergent levels.', position: 1 },
          { label: 'Ice well clean', description: 'No debris or glass.', position: 2 },
          { label: 'Keg lines secure', description: 'No leaks or obstruction in back dock.', position: 3 }
        ]
      }
    },
    include: { items: { orderBy: { position: 'asc' } } }
  });

  const failedIssueA = issueIds.find((issue) => issue.title.includes('Hand wash station soap dispenser empty'));
  const failedIssueB = issueIds.find((issue) => issue.title.includes('Rear prep floor tiles slippery after mop down'));
  const failedIssueC = issueIds.find((issue) => issue.title.includes('Glass washer rinse aid alert active'));

  await prisma.checklistRun.create({
    data: {
      templateId: openingTemplate.id,
      area: 'Front of House',
      performedBy: 'Sarah',
      status: 'COMPLETED',
      notes: 'Two failures carried into issues queue.',
      runDate: new Date(),
      items: {
        create: openingTemplate.items.map((item) => ({
          templateItemId: item.id,
          label: item.label,
          description: item.description,
          position: item.position,
          result: item.label === 'Hand wash stations stocked' ? 'FAIL' : 'PASS',
          notes: item.label === 'Hand wash stations stocked' ? 'Prep sink dispenser empty at open.' : 'Checked and good.',
          linkedIssueId: item.label === 'Hand wash stations stocked' ? failedIssueA?.id : null
        }))
      }
    }
  });

  await prisma.checklistRun.create({
    data: {
      templateId: closeTemplate.id,
      area: 'Kitchen',
      performedBy: 'Marco',
      status: 'COMPLETED',
      notes: 'Slip risk still unresolved after close clean.',
      runDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      items: {
        create: closeTemplate.items.map((item) => ({
          templateItemId: item.id,
          label: item.label,
          description: item.description,
          position: item.position,
          result: item.label === 'Floors safe after mop' ? 'FAIL' : 'PASS',
          notes: item.label === 'Floors safe after mop' ? 'Still slick after 25 minutes.' : 'Completed.',
          linkedIssueId: item.label === 'Floors safe after mop' ? failedIssueB?.id : null
        }))
      }
    }
  });

  await prisma.checklistRun.create({
    data: {
      templateId: barTemplate.id,
      area: 'Bar',
      performedBy: 'Tayla',
      status: 'IN_PROGRESS',
      notes: 'Waiting on maintenance check.',
      runDate: new Date(),
      items: {
        create: barTemplate.items.map((item) => ({
          templateItemId: item.id,
          label: item.label,
          description: item.description,
          position: item.position,
          result: item.label === 'Glass washer chemicals topped up' ? 'FAIL' : item.label === 'Ice well clean' ? 'PASS' : 'PENDING',
          notes: item.label === 'Glass washer chemicals topped up' ? 'Rinse aid low alarm still showing.' : '',
          linkedIssueId: item.label === 'Glass washer chemicals topped up' ? failedIssueC?.id : null
        }))
      }
    }
  });
}

async function seedAudits(issueIds: { id: string; title: string }[]) {
  const nswInspection = await prisma.auditTemplate.create({
    data: {
      name: 'NSW Food Premises Inspection (FPAR V.8)',
      sections: {
        create: [
          {
            title: 'General & Food Safety Supervisor',
            description:
              'Food Safety Supervisor appointed for the premises. FSS certificate is current and available on site. All food handlers have appropriate skills and knowledge for the tasks they perform. Notification of food business details to NSW Food Authority is current.',
            position: 1
          },
          {
            title: 'Food Handling Controls',
            description:
              'Food received from approved suppliers at correct temperature. Raw meats stored below ready to eat foods. Food covered, dated and within use by. Hot holding, cold display, cooling, reheating and cross contamination controls checked.',
            position: 2
          },
          {
            title: 'Health & Hygiene Requirements',
            description:
              'Ill food handlers excluded from food handling. Hand wash basins accessible and stocked. Food handlers wash hands at required trigger points. Personal hygiene, gloves and clothing checked.',
            position: 3
          },
          {
            title: 'Cleaning & Sanitising',
            description:
              'Premises, fixtures, fittings and equipment clean. Food contact surfaces cleaned and sanitised. Sanitiser available and suitable. Chemicals labelled and stored away from food.',
            position: 4
          },
          {
            title: 'Maintenance of Premises & Equipment',
            description:
              'Floors, walls, ceilings, fixtures and fittings in sound repair. Equipment working correctly. Thermometers accurate. Lighting and ventilation adequate. Faults logged.',
            position: 5
          },
          {
            title: 'Pest Control',
            description:
              'No evidence of pests. Entry points sealed or screened. External bins closed. Pest control service records available.',
            position: 6
          },
          {
            title: 'Labelling, Traceability & Recalls',
            description:
              'Labels, allergen information, supplier invoices, delivery records and recall process checked.',
            position: 7
          }
        ]
      }
    },
    include: { sections: { orderBy: { position: 'asc' } } }
  });

  const auditTemplate = await prisma.auditTemplate.create({
    data: {
      name: 'Monthly Compliance Review',
      sections: {
        create: [
          { title: 'Food Safety', description: 'Storage, handling, records.', position: 1 },
          { title: 'Work Health and Safety', description: 'Hazards, exits, first aid.', position: 2 },
          { title: 'Documentation', description: 'Logs, declarations, supplier records.', position: 3 }
        ]
      }
    },
    include: { sections: { orderBy: { position: 'asc' } } }
  });

  await prisma.auditRun.create({
    data: {
      templateId: auditTemplate.id,
      title: 'April Monthly Compliance Review',
      score: 82,
      summary: 'Strong general performance with several documentation and housekeeping follow ups.',
      runDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      findings: {
        create: [
          {
            sectionTitle: 'Food Safety',
            finding: 'Hand wash station soap refill missed in opening setup.',
            score: 65,
            linkedIssueId: issueIds.find((issue) => issue.title.includes('Hand wash station soap dispenser empty'))?.id
          },
          {
            sectionTitle: 'Work Health and Safety',
            finding: 'Rear fire exit was reduced by keg staging.',
            score: 40,
            linkedIssueId: issueIds.find((issue) => issue.title.includes('Back dock fire exit partially obstructed'))?.id
          },
          {
            sectionTitle: 'Documentation',
            finding: 'Allergen declaration file not updated to current supplier version.',
            score: 70,
            linkedIssueId: issueIds.find((issue) => issue.title.includes('Supplier allergen spec sheet outdated'))?.id
          }
        ]
      }
    }
  });

  await prisma.auditRun.create({
    data: {
      templateId: nswInspection.id,
      title: 'Q2 NSW FPAR self inspection Alma Avalon',
      score: 88,
      summary: 'Self run using the NSW inspector checklist. Food handling, hygiene and pest control clean. Documentation and maintenance items flagged.',
      runDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      findings: {
        create: [
          {
            sectionTitle: 'Health & Hygiene Requirements',
            finding: 'Hand wash basin in bar area missing soap at open. Topped up during walkthrough.',
            score: 75,
            linkedIssueId: issueIds.find((issue) => issue.title.includes('Hand wash station soap dispenser empty'))?.id
          },
          {
            sectionTitle: 'Maintenance of Premises & Equipment',
            finding: 'Walk in coolroom door seal perished on lower third. Impacts temperature hold.',
            score: 55,
            linkedIssueId: null
          },
          {
            sectionTitle: 'Labelling, Traceability & Recalls',
            finding: 'Allergen declaration file did not reflect current supplier version for key dry goods.',
            score: 70,
            linkedIssueId: issueIds.find((issue) => issue.title.includes('Supplier allergen spec sheet outdated'))?.id
          }
        ]
      }
    }
  });
}

async function seedLiquorLicences() {
  await prisma.liquorLicence.upsert({
    where: { licenceNumber: 'LIQO660033801' },
    update: {
      venue: 'Alma Avalon',
      licenceType: 'ON_PREMISES',
      status: 'ACTIVE',
      licensee: 'Austin Keith Andrews-little',
      issuer: 'NSW Liquor & Gaming',
      issueDate: new Date('2017-08-22'),
      expiryDate: null,
      tradingHours:
        'Good Friday 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. Christmas Day 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. December 31 normal opening time until normal closing time or 2:00 AM on New Year’s Day, whichever is later.',
      conditions:
        'Section 11A of the Liquor Act 2007 applies. Liquor must not be sold by retail on the licensed premises for a continuous period of 6 hours during each consecutive period of 24 hours.',
      restrictions:
        'Licence conditions imposed by the Liquor Act and Regulation apply. Development consent may further restrict trading hours.',
      notes:
        'Business type: Restaurant. Business owner/entity: TWO COOKED CHOOKS PTY LTD. ABN: 37615015042. Premises: 47 Old Barrenjoey Rd, Avalon Beach NSW 2107. LGA: Northern Beaches.',
      documentName: 'NSW Verify Licence Alma Avalon LIQO660033801',
      documentUrl: 'https://verify.licence.nsw.gov.au/'
    },
    create: {
      venue: 'Alma Avalon',
      licenceNumber: 'LIQO660033801',
      licenceType: 'ON_PREMISES',
      status: 'ACTIVE',
      licensee: 'Austin Keith Andrews-little',
      issuer: 'NSW Liquor & Gaming',
      issueDate: new Date('2017-08-22'),
      expiryDate: null,
      tradingHours:
        'Good Friday 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. Christmas Day 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. December 31 normal opening time until normal closing time or 2:00 AM on New Year’s Day, whichever is later.',
      conditions:
        'Section 11A of the Liquor Act 2007 applies. Liquor must not be sold by retail on the licensed premises for a continuous period of 6 hours during each consecutive period of 24 hours.',
      restrictions:
        'Licence conditions imposed by the Liquor Act and Regulation apply. Development consent may further restrict trading hours.',
      notes:
        'Business type: Restaurant. Business owner/entity: TWO COOKED CHOOKS PTY LTD. ABN: 37615015042. Premises: 47 Old Barrenjoey Rd, Avalon Beach NSW 2107. LGA: Northern Beaches.',
      documentName: 'NSW Verify Licence Alma Avalon LIQO660033801',
      documentUrl: 'https://verify.licence.nsw.gov.au/'
    }
  });

  await prisma.liquorLicence.upsert({
    where: { licenceNumber: 'LIQO660036418' },
    update: {
      venue: 'St Alma',
      licenceType: 'ON_PREMISES',
      status: 'ACTIVE',
      licensee: 'Dirk Issei Wright',
      issuer: 'NSW Liquor & Gaming',
      issueDate: new Date('2021-12-15'),
      expiryDate: null,
      tradingHours:
        'Good Friday 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. Christmas Day 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. December 31 normal opening time until normal closing time or 2:00 AM on New Year’s Day, whichever is later.',
      conditions:
        'Section 11A of the Liquor Act 2007 applies. Liquor must not be sold by retail on the licensed premises for a continuous period of 6 hours between 04:00 AM and 10:00 AM during each consecutive period of 24 hours.',
      restrictions:
        'Licence conditions imposed by the Liquor Act and Regulation apply. Development consent may further restrict trading hours.',
      notes:
        'Business type: Restaurant. Business owner/entity: ALMA FRESHWATER PTY LTD. ABN: 72648576032. Premises: 20 Albert St, Freshwater NSW 2096. LGA: Northern Beaches. Website listed: http://www.st-alma.com.au.',
      documentName: 'NSW Verify Licence St Alma LIQO660036418',
      documentUrl: 'https://verify.licence.nsw.gov.au/'
    },
    create: {
      venue: 'St Alma',
      licenceNumber: 'LIQO660036418',
      licenceType: 'ON_PREMISES',
      status: 'ACTIVE',
      licensee: 'Dirk Issei Wright',
      issuer: 'NSW Liquor & Gaming',
      issueDate: new Date('2021-12-15'),
      expiryDate: null,
      tradingHours:
        'Good Friday 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. Christmas Day 12:00 noon to 10:00 PM with liquor served only with or ancillary to a meal in a dining area. December 31 normal opening time until normal closing time or 2:00 AM on New Year’s Day, whichever is later.',
      conditions:
        'Section 11A of the Liquor Act 2007 applies. Liquor must not be sold by retail on the licensed premises for a continuous period of 6 hours between 04:00 AM and 10:00 AM during each consecutive period of 24 hours.',
      restrictions:
        'Licence conditions imposed by the Liquor Act and Regulation apply. Development consent may further restrict trading hours.',
      notes:
        'Business type: Restaurant. Business owner/entity: ALMA FRESHWATER PTY LTD. ABN: 72648576032. Premises: 20 Albert St, Freshwater NSW 2096. LGA: Northern Beaches. Website listed: http://www.st-alma.com.au.',
      documentName: 'NSW Verify Licence St Alma LIQO660036418',
      documentUrl: 'https://verify.licence.nsw.gov.au/'
    }
  });
}

async function seedStaff() {
  const managerHash = await bcrypt.hash('ManagerBeta2026!', 10);
  const staffHash = await bcrypt.hash('StaffBeta2026!', 10);

  await prisma.staffProfile.create({
    data: {
      firstName: 'Bonnie',
      lastName: 'Rivera',
      roleTitle: 'Venue Manager',
      email: 'manager@alma.local',
      phone: '0400 000 111',
      venue: 'Alma Avalon',
      startDate: new Date('2025-11-04'),
      notes: 'Primary liquor compliance contact for Avalon bar.',
      passwordHash: managerHash,
      isAdmin: false,
      appAccess: {
        create: [
          { appId: 'COMPLIANCE', status: 'ENABLED', role: 'MANAGER', notes: 'Staff beta manager account' },
          { appId: 'STAFF', status: 'ENABLED', role: 'MANAGER', notes: 'Can manage staff onboarding during beta' },
          { appId: 'STOCK', status: 'ENABLED', role: 'MANAGER', notes: 'Can view stock during beta' }
        ]
      },
      records: {
        create: [
          {
            recordType: 'RSA',
            title: 'NSW RSA certificate',
            issuer: 'Liquor & Gaming NSW',
            certificateNumber: 'RSA-88421',
            issueDate: new Date('2025-11-10'),
            expiryDate: new Date('2027-11-10'),
            status: 'APPROVED',
            documentName: 'bonnie-rsa.pdf',
            documentUrl: 'https://example.com/staff/bonnie-rsa.pdf'
          },
          {
            recordType: 'FOOD_SAFETY',
            title: 'Food safety supervisor refresher',
            issuer: 'Hospitality Safe',
            issueDate: new Date('2026-01-18'),
            expiryDate: new Date('2027-01-18'),
            status: 'APPROVED'
          }
        ]
      }
    }
  });

  await prisma.staffProfile.create({
    data: {
      firstName: 'Mateo',
      lastName: 'Silva',
      roleTitle: 'Duty Manager',
      email: 'mateo.silva@alma.local',
      venue: 'St Alma',
      startDate: new Date('2025-08-20'),
      appAccess: {
        create: [
          { appId: 'COMPLIANCE', status: 'ENABLED', role: 'MANAGER', notes: 'Duty manager compliance testing' }
        ]
      },
      records: {
        create: [
          {
            recordType: 'RSA',
            title: 'NZ LCQ / duty manager conversion',
            issuer: 'Compliance Training Group',
            certificateNumber: 'LCQ-1044',
            issueDate: new Date('2025-08-22'),
            expiryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            status: 'APPROVED'
          },
          {
            recordType: 'FIRST_AID',
            title: 'Provide First Aid',
            issuer: 'St John',
            issueDate: new Date('2023-05-14'),
            expiryDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            status: 'EXPIRED'
          }
        ]
      }
    }
  });

  await prisma.staffProfile.create({
    data: {
      firstName: 'Sam',
      lastName: 'Taylor',
      roleTitle: 'Floor Staff',
      email: 'staff@alma.local',
      venue: 'Alma Avalon',
      employmentStatus: 'ACTIVE',
      passwordHash: staffHash,
      appAccess: {
        create: [
          { appId: 'COMPLIANCE', status: 'ENABLED', role: 'STAFF', notes: 'Staff beta test account' }
        ]
      },
      records: {
        create: [
          {
            recordType: 'RSA',
            title: 'RSA pending upload',
            status: 'PENDING',
            notes: 'Working under supervision until cert uploaded.'
          }
        ]
      }
    }
  });
}

async function seedIncidents(issueIds: { id: string; title: string }[]) {
  const linkedIssue = issueIds.find((issue) => issue.title.includes('Rear prep floor tiles slippery'));

  await prisma.incidentReport.create({
    data: {
      title: 'Prep area slip near miss',
      incidentType: 'Near Miss',
      severity: 'HIGH',
      status: 'UNDER_REVIEW',
      occurredAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      reportedBy: 'Sarah',
      venue: 'Alma Avalon',
      location: 'Rear prep corridor',
      summary: 'Team member slipped after mop down but caught bench before falling.',
      immediateActions: 'Area re-mopped with lower dilution and hazard sign left in place.',
      followUpRequired: true,
      followUpNotes: 'Review close clean chemical dilution and dry time.',
      linkedIssueId: linkedIssue?.id,
      people: {
        create: [
          {
            name: 'Amy Hart',
            role: 'Kitchen staff',
            involvement: 'Affected person',
            injuryDetails: 'No injury reported.'
          },
          {
            name: 'Marco',
            role: 'Closing supervisor',
            involvement: 'Witness',
            witnessStatement: 'Observed floor still slick after standard wait time.'
          }
        ]
      }
    }
  });

  await prisma.incidentReport.create({
    data: {
      title: 'Minor hand cut during garnish prep',
      incidentType: 'First Aid',
      severity: 'MEDIUM',
      status: 'CLOSED',
      occurredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      reportedBy: 'Bonnie',
      venue: 'St Alma',
      location: 'Cold prep bench',
      summary: 'Small knife cut treated on site and bandaged.',
      treatmentProvided: 'Wound cleaned, bandaged, glove replaced.',
      followUpRequired: false,
      people: {
        create: [
          {
            name: 'Jared Moss',
            role: 'Commis chef',
            involvement: 'Affected person',
            injuryDetails: 'Superficial cut to left index finger.'
          }
        ]
      }
    }
  });
}

async function seedTemperatures() {
  const coolRoom = await prisma.temperatureAsset.create({
    data: {
      name: 'Main cool room',
      venue: 'Alma Avalon',
      area: 'Kitchen',
      assetType: 'Cool Room',
      minTempC: 1,
      maxTempC: 5,
      integrationProvider: 'govee',
      externalDeviceId: 'demo-device-cool-room',
      externalModel: 'H5108',
      notes: 'Primary food holding asset.'
    }
  });

  const seafoodFridge = await prisma.temperatureAsset.create({
    data: {
      name: 'Seafood underbench fridge',
      venue: 'St Alma',
      area: 'Prep',
      assetType: 'Fridge',
      minTempC: 0,
      maxTempC: 4,
      integrationProvider: 'govee',
      externalDeviceId: 'demo-device-seafood',
      externalModel: 'H5108'
    }
  });

  const freezer = await prisma.temperatureAsset.create({
    data: {
      name: 'Dessert freezer',
      venue: 'Alma Avalon',
      area: 'Pastry',
      assetType: 'Freezer',
      minTempC: -23,
      maxTempC: -16
    }
  });

  const now = Date.now();

  await prisma.temperatureLog.createMany({
    data: [
      {
        assetId: coolRoom.id,
        recordedAt: new Date(now - 2 * 60 * 60 * 1000),
        temperatureC: 3.1,
        humidityPct: 68,
        source: 'GOVEE',
        status: 'IN_RANGE',
        recordedBy: 'system'
      },
      {
        assetId: coolRoom.id,
        recordedAt: new Date(now - 60 * 60 * 1000),
        temperatureC: 6.2,
        humidityPct: 70,
        source: 'GOVEE',
        status: 'OUT_OF_RANGE',
        correctiveAction: 'Door seal checked and stock reorganised for airflow.',
        recordedBy: 'system'
      },
      {
        assetId: seafoodFridge.id,
        recordedAt: new Date(now - 90 * 60 * 1000),
        temperatureC: 2.4,
        humidityPct: 61,
        source: 'GOVEE',
        status: 'IN_RANGE',
        recordedBy: 'system'
      },
      {
        assetId: freezer.id,
        recordedAt: new Date(now - 3 * 60 * 60 * 1000),
        temperatureC: -18.5,
        source: 'MANUAL',
        status: 'IN_RANGE',
        recordedBy: 'Pastry close'
      }
    ]
  });

  await prisma.temperatureAsset.update({
    where: { id: coolRoom.id },
    data: {
      lastReadingAt: new Date(now - 60 * 60 * 1000),
      lastSyncAt: new Date(now - 60 * 60 * 1000)
    }
  });

  await prisma.temperatureAsset.update({
    where: { id: seafoodFridge.id },
    data: {
      lastReadingAt: new Date(now - 90 * 60 * 1000),
      lastSyncAt: new Date(now - 90 * 60 * 1000)
    }
  });

  await prisma.temperatureAsset.update({
    where: { id: freezer.id },
    data: {
      lastReadingAt: new Date(now - 3 * 60 * 60 * 1000)
    }
  });
}

async function seedAdminAndSettings() {
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      id: 'singleton',
      orgName: 'Alma Hospitality',
      primaryContactName: 'Tim Christensen',
      primaryContactEmail: 'tim@alma.local',
      venues: [
        { name: 'Alma Avalon', address: 'Avalon Beach NSW', phone: '' },
        { name: 'St Alma', address: 'Freshwater NSW', phone: '' }
      ]
    }
  });

  const passwordHash = await bcrypt.hash('almaadmin', 10);
  const admin = await prisma.staffProfile.upsert({
    where: { email: 'admin@alma.local' },
    update: { passwordHash, isAdmin: true },
    create: {
      firstName: 'Tim',
      lastName: 'Christensen',
      roleTitle: 'Owner / Admin',
      email: 'admin@alma.local',
      venue: 'Alma Avalon',
      employmentStatus: 'ACTIVE',
      isAdmin: true,
      passwordHash
    }
  });

  await prisma.staffAppAccess.upsert({
    where: { staffProfileId_appId: { staffProfileId: admin.id, appId: 'COMPLIANCE' } },
    update: { status: 'ENABLED', role: 'ADMIN', notes: 'Staff beta admin account' },
    create: { staffProfileId: admin.id, appId: 'COMPLIANCE', status: 'ENABLED', role: 'ADMIN', notes: 'Staff beta admin account' }
  });

  await prisma.staffAppAccess.upsert({
    where: { staffProfileId_appId: { staffProfileId: admin.id, appId: 'STAFF' } },
    update: { status: 'ENABLED', role: 'ADMIN', notes: 'Staff beta admin account' },
    create: { staffProfileId: admin.id, appId: 'STAFF', status: 'ENABLED', role: 'ADMIN', notes: 'Staff beta admin account' }
  });

  const masterHash = await bcrypt.hash('Tim@lma2017', 10);
  const master = await prisma.staffProfile.upsert({
    where: { email: 'tim@almagroup.com.au' },
    update: { passwordHash: masterHash, isAdmin: true },
    create: {
      firstName: 'Tim',
      lastName: 'Christensen',
      roleTitle: 'Owner / Master Admin',
      email: 'tim@almagroup.com.au',
      venue: 'Alma Avalon',
      employmentStatus: 'ACTIVE',
      isAdmin: true,
      passwordHash: masterHash
    }
  });

  await prisma.staffAppAccess.upsert({
    where: { staffProfileId_appId: { staffProfileId: master.id, appId: 'COMPLIANCE' } },
    update: { status: 'ENABLED', role: 'ADMIN', notes: 'Owner admin account' },
    create: { staffProfileId: master.id, appId: 'COMPLIANCE', status: 'ENABLED', role: 'ADMIN', notes: 'Owner admin account' }
  });

  console.log('Seed admin login: admin@alma.local / almaadmin');
  console.log('Seed manager login: manager@alma.local / ManagerBeta2026!');
  console.log('Seed staff login: staff@alma.local / StaffBeta2026!');
  console.log('Master login: tim@almagroup.com.au / Tim@lma2017');
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('pnpm db:seed is local/demo only and must not run in production. Use pnpm db:seed:prod instead.');
  }

  await reset();
  const issues = await seedIssues();
  await seedChecklists(issues);
  await seedAudits(issues);
  await seedLiquorLicences();
  await seedStaff();
  await seedIncidents(issues);
  await seedTemperatures();
  await seedAdminAndSettings();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
