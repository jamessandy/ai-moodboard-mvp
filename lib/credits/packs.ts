export const CREDIT_PACKS = {
  starter: { name: '500 Moodblendy credits', credits: 500, amountCents: 500 },
  creator: { name: '1,500 Moodblendy credits', credits: 1500, amountCents: 1500 },
  studio: { name: '5,000 Moodblendy credits', credits: 5000, amountCents: 5000 },
} as const

export type CreditPackId = keyof typeof CREDIT_PACKS
