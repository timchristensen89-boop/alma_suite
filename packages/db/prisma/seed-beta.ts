import bcrypt from 'bcryptjs';
import { prisma } from '../src/prisma.js';

const betaUsers = [
  {
    email: 'admin@alma.local',
    password: 'almaadmin',
    firstName: 'Tim',
    lastName: 'Christensen',
    roleTitle: 'Owner / Admin',
    venue: 'Alma Avalon',
    isAdmin: true,
    access: [
      { appId: 'COMPLIANCE' as const, role: 'ADMIN' },
      { appId: 'STAFF' as const, role: 'ADMIN' }
    ]
  },
  {
    email: 'manager@alma.local',
    password: 'ManagerBeta2026!',
    firstName: 'Bonnie',
    lastName: 'Rivera',
    roleTitle: 'Venue Manager',
    venue: 'Alma Avalon',
    isAdmin: false,
    access: [
      { appId: 'COMPLIANCE' as const, role: 'MANAGER' },
      { appId: 'STAFF' as const, role: 'MANAGER' },
      { appId: 'STOCK' as const, role: 'MANAGER' }
    ]
  },
  {
    email: 'staff@alma.local',
    password: 'StaffBeta2026!',
    firstName: 'Sam',
    lastName: 'Taylor',
    roleTitle: 'Floor Staff',
    venue: 'Alma Avalon',
    isAdmin: false,
    access: [{ appId: 'COMPLIANCE' as const, role: 'STAFF' }]
  },
  {
    email: 'tim@almagroup.com.au',
    password: 'Tim@lma2017',
    firstName: 'Tim',
    lastName: 'Christensen',
    roleTitle: 'Owner / Master Admin',
    venue: 'Alma Avalon',
    isAdmin: true,
    access: [
      { appId: 'COMPLIANCE' as const, role: 'ADMIN' },
      { appId: 'STAFF' as const, role: 'ADMIN' },
      { appId: 'STOCK' as const, role: 'ADMIN' }
    ]
  }
];

async function seedSettings() {
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {
      orgName: 'Alma Hospitality',
      primaryContactName: 'Tim Christensen',
      primaryContactEmail: 'tim@almagroup.com.au',
      venues: [
        { name: 'Alma Avalon', address: '47 Old Barrenjoey Rd, Avalon Beach NSW', phone: '' },
        { name: 'St Alma', address: '20 Albert St, Freshwater NSW', phone: '' }
      ]
    },
    create: {
      id: 'singleton',
      orgName: 'Alma Hospitality',
      primaryContactName: 'Tim Christensen',
      primaryContactEmail: 'tim@almagroup.com.au',
      venues: [
        { name: 'Alma Avalon', address: '47 Old Barrenjoey Rd, Avalon Beach NSW', phone: '' },
        { name: 'St Alma', address: '20 Albert St, Freshwater NSW', phone: '' }
      ]
    }
  });
}

async function seedBetaUsers() {
  for (const user of betaUsers) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const profile = await prisma.staffProfile.upsert({
      where: { email: user.email },
      update: {
        firstName: user.firstName,
        lastName: user.lastName,
        roleTitle: user.roleTitle,
        venue: user.venue,
        employmentStatus: 'ACTIVE',
        isAdmin: user.isAdmin,
        passwordHash
      },
      create: {
        firstName: user.firstName,
        lastName: user.lastName,
        roleTitle: user.roleTitle,
        email: user.email,
        venue: user.venue,
        employmentStatus: 'ACTIVE',
        isAdmin: user.isAdmin,
        passwordHash
      }
    });

    for (const access of user.access) {
      await prisma.staffAppAccess.upsert({
        where: { staffProfileId_appId: { staffProfileId: profile.id, appId: access.appId } },
        update: {
          status: 'ENABLED',
          role: access.role,
          notes: 'Controlled staff beta account'
        },
        create: {
          staffProfileId: profile.id,
          appId: access.appId,
          status: 'ENABLED',
          role: access.role,
          notes: 'Controlled staff beta account'
        }
      });
    }

    if (user.email === 'manager@alma.local') {
      await prisma.staffComplianceRecord.deleteMany({ where: { staffProfileId: profile.id } });
      await prisma.staffComplianceRecord.createMany({
        data: [
          {
            staffProfileId: profile.id,
            recordType: 'RSA',
            title: 'NSW RSA certificate',
            issuer: 'Liquor & Gaming NSW',
            certificateNumber: 'RSA-88421',
            issueDate: new Date('2025-11-10'),
            expiryDate: new Date('2027-11-10'),
            status: 'APPROVED'
          },
          {
            staffProfileId: profile.id,
            recordType: 'FOOD_SAFETY',
            title: 'Food safety supervisor refresher',
            issuer: 'Hospitality Safe',
            issueDate: new Date('2026-01-18'),
            expiryDate: new Date('2027-01-18'),
            status: 'APPROVED'
          }
        ]
      });
    }

    if (user.email === 'staff@alma.local') {
      await prisma.staffComplianceRecord.deleteMany({ where: { staffProfileId: profile.id } });
      await prisma.staffComplianceRecord.create({
        data: {
          staffProfileId: profile.id,
          recordType: 'RSA',
          title: 'RSA pending upload',
          status: 'PENDING',
          notes: 'Working under supervision until cert uploaded.'
        }
      });
    }
  }
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

async function seedBetaIssue() {
  await prisma.issue.upsert({
    where: { legacyId: 'beta-issue-fire-exit' },
    update: {
      title: 'Back dock fire exit partially obstructed',
      description: 'Beverage kegs left in front of the rear fire exit reduced safe egress width.',
      severity: 'CRITICAL',
      category: 'Safety',
      status: 'IN_PROGRESS',
      assignee: 'Venue Manager',
      notes: 'Area cleared temporarily, storage map needs update.'
    },
    create: {
      legacyId: 'beta-issue-fire-exit',
      title: 'Back dock fire exit partially obstructed',
      description: 'Beverage kegs left in front of the rear fire exit reduced safe egress width.',
      severity: 'CRITICAL',
      category: 'Safety',
      status: 'IN_PROGRESS',
      assignee: 'Venue Manager',
      dueDate: new Date(),
      notes: 'Area cleared temporarily, storage map needs update.',
      activities: {
        create: [
          { action: 'created', message: 'Issue raised from staff beta seed.', actor: 'system' },
          { action: 'assigned', message: 'Assigned to Venue Manager for follow up.', actor: 'system' }
        ]
      }
    }
  });
}

async function seedChecklistTemplate() {
  const existing = await prisma.checklistTemplate.findUnique({
    where: { legacyId: 'beta-opening-safety-check' }
  });
  if (existing) return;

  await prisma.checklistTemplate.create({
    data: {
      legacyId: 'beta-opening-safety-check',
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
    }
  });
}

async function seedStockBetaData() {
  const dryGoods = await prisma.stockCategory.upsert({
    where: { name: 'Dry Goods' },
    update: { description: 'Shelf stable kitchen stock for beta testing.' },
    create: { legacyId: 'beta-stock-category-dry-goods', name: 'Dry Goods', description: 'Shelf stable kitchen stock for beta testing.' }
  });
  const beverage = await prisma.stockCategory.upsert({
    where: { name: 'Beverage' },
    update: { description: 'Bar and beverage stock for beta testing.' },
    create: { legacyId: 'beta-stock-category-beverage', name: 'Beverage', description: 'Bar and beverage stock for beta testing.' }
  });
  const produce = await prisma.stockCategory.upsert({
    where: { name: 'Produce' },
    update: { description: 'Fresh produce and prep stock for beta testing.' },
    create: { legacyId: 'beta-stock-category-produce', name: 'Produce', description: 'Fresh produce and prep stock for beta testing.' }
  });

  const tortillas = await prisma.stockItem.upsert({
    where: { legacyId: 'beta-stock-item-corn-tortillas' },
    update: {
      sku: 'ALMA-TORT-CORN',
      name: 'Corn tortillas 6 inch',
      categoryId: dryGoods.id,
      unit: 'pack',
      onHand: 18,
      parLevel: 24,
      reorderPoint: 10,
      avgCostCents: 420,
      status: 'ACTIVE',
      notes: 'Used across tacos and staff meal testing.'
    },
    create: {
      legacyId: 'beta-stock-item-corn-tortillas',
      sku: 'ALMA-TORT-CORN',
      name: 'Corn tortillas 6 inch',
      categoryId: dryGoods.id,
      unit: 'pack',
      onHand: 18,
      parLevel: 24,
      reorderPoint: 10,
      avgCostCents: 420,
      status: 'ACTIVE',
      notes: 'Used across tacos and staff meal testing.'
    }
  });

  const tequila = await prisma.stockItem.upsert({
    where: { legacyId: 'beta-stock-item-house-tequila' },
    update: {
      sku: 'BAR-TEQ-HOUSE',
      name: 'House tequila blanco',
      categoryId: beverage.id,
      unit: 'bottle',
      onHand: 7,
      parLevel: 12,
      reorderPoint: 5,
      avgCostCents: 4800,
      status: 'ACTIVE',
      notes: 'Low stock example for reorder testing.'
    },
    create: {
      legacyId: 'beta-stock-item-house-tequila',
      sku: 'BAR-TEQ-HOUSE',
      name: 'House tequila blanco',
      categoryId: beverage.id,
      unit: 'bottle',
      onHand: 7,
      parLevel: 12,
      reorderPoint: 5,
      avgCostCents: 4800,
      status: 'ACTIVE',
      notes: 'Low stock example for reorder testing.'
    }
  });

  const avocado = await prisma.stockItem.upsert({
    where: { legacyId: 'beta-stock-item-avocado' },
    update: {
      sku: 'PROD-AVO-HASS',
      name: 'Hass avocado',
      categoryId: produce.id,
      unit: 'each',
      onHand: 42,
      parLevel: 60,
      reorderPoint: 24,
      avgCostCents: 220,
      status: 'ACTIVE'
    },
    create: {
      legacyId: 'beta-stock-item-avocado',
      sku: 'PROD-AVO-HASS',
      name: 'Hass avocado',
      categoryId: produce.id,
      unit: 'each',
      onHand: 42,
      parLevel: 60,
      reorderPoint: 24,
      avgCostCents: 220,
      status: 'ACTIVE'
    }
  });

  await prisma.supplier.upsert({
    where: { legacyId: 'beta-supplier-fresh-produce' },
    update: {
      name: 'Northern Beaches Fresh Produce',
      contactName: 'Accounts Team',
      email: 'orders@nbfresh.example',
      phone: '02 9000 0101',
      paymentTerms: '7 days',
      status: 'ACTIVE',
      notes: 'Demo supplier for produce ordering and duplicate cleanup testing.'
    },
    create: {
      legacyId: 'beta-supplier-fresh-produce',
      name: 'Northern Beaches Fresh Produce',
      contactName: 'Accounts Team',
      email: 'orders@nbfresh.example',
      phone: '02 9000 0101',
      paymentTerms: '7 days',
      status: 'ACTIVE',
      notes: 'Demo supplier for produce ordering and duplicate cleanup testing.'
    }
  });

  await prisma.supplier.upsert({
    where: { legacyId: 'beta-supplier-bar' },
    update: {
      name: 'Coastal Beverage Co',
      contactName: 'Wholesale Desk',
      email: 'wholesale@coastalbev.example',
      phone: '02 9000 0202',
      paymentTerms: '14 days',
      status: 'ACTIVE',
      notes: 'Demo supplier for bar ordering.'
    },
    create: {
      legacyId: 'beta-supplier-bar',
      name: 'Coastal Beverage Co',
      contactName: 'Wholesale Desk',
      email: 'wholesale@coastalbev.example',
      phone: '02 9000 0202',
      paymentTerms: '14 days',
      status: 'ACTIVE',
      notes: 'Demo supplier for bar ordering.'
    }
  });

  await prisma.recipe.upsert({
    where: { legacyId: 'beta-recipe-guacamole' },
    update: {
      title: 'Guacamole',
      kind: 'Prep',
      category: 'Kitchen',
      subcategory: 'Salsa and dips',
      venue: 'Both venues',
      estimatedCost: 8.6,
      notes: 'Demo recipe for linked stock item testing.',
      lines: {
        deleteMany: {},
        create: [
          { position: 1, ingredientName: 'Hass avocado', quantity: 4, unit: 'each', cost: 8.8, itemId: avocado.id },
          { position: 2, ingredientName: 'Corn tortillas 6 inch', quantity: 1, unit: 'pack', cost: 4.2, itemId: tortillas.id }
        ]
      }
    },
    create: {
      legacyId: 'beta-recipe-guacamole',
      title: 'Guacamole',
      kind: 'Prep',
      category: 'Kitchen',
      subcategory: 'Salsa and dips',
      venue: 'Both venues',
      estimatedCost: 8.6,
      notes: 'Demo recipe for linked stock item testing.',
      lines: {
        create: [
          { position: 1, ingredientName: 'Hass avocado', quantity: 4, unit: 'each', cost: 8.8, itemId: avocado.id },
          { position: 2, ingredientName: 'Corn tortillas 6 inch', quantity: 1, unit: 'pack', cost: 4.2, itemId: tortillas.id }
        ]
      }
    }
  });

  await prisma.stocktake.upsert({
    where: { legacyId: 'beta-stocktake-opening' },
    update: {
      name: 'Opening stock count',
      venue: 'Alma Avalon',
      template: 'Weekly bar and kitchen',
      countedAt: new Date(),
      status: 'IN_PROGRESS',
      notes: 'Demo stocktake for beta testing.',
      lines: {
        deleteMany: {},
        create: [
          { position: 1, itemId: tortillas.id, label: tortillas.name, countedQty: 18, unit: 'pack', location: 'Dry store' },
          { position: 2, itemId: tequila.id, label: tequila.name, countedQty: 7, unit: 'bottle', location: 'Bar' },
          { position: 3, itemId: avocado.id, label: avocado.name, countedQty: 42, unit: 'each', location: 'Cool room' }
        ]
      }
    },
    create: {
      legacyId: 'beta-stocktake-opening',
      name: 'Opening stock count',
      venue: 'Alma Avalon',
      template: 'Weekly bar and kitchen',
      countedAt: new Date(),
      status: 'IN_PROGRESS',
      notes: 'Demo stocktake for beta testing.',
      lines: {
        create: [
          { position: 1, itemId: tortillas.id, label: tortillas.name, countedQty: 18, unit: 'pack', location: 'Dry store' },
          { position: 2, itemId: tequila.id, label: tequila.name, countedQty: 7, unit: 'bottle', location: 'Bar' },
          { position: 3, itemId: avocado.id, label: avocado.name, countedQty: 42, unit: 'each', location: 'Cool room' }
        ]
      }
    }
  });
}

async function main() {
  await seedSettings();
  await seedBetaUsers();
  await seedLiquorLicences();
  await seedBetaIssue();
  await seedChecklistTemplate();
  await seedStockBetaData();

  console.log('Beta seed complete.');
  console.log('Admin: admin@alma.local / almaadmin');
  console.log('Manager: manager@alma.local / ManagerBeta2026!');
  console.log('Staff: staff@alma.local / StaffBeta2026!');
  console.log('Owner: tim@almagroup.com.au / Tim@lma2017');
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
