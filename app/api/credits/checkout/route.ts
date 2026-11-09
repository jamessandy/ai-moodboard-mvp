import Stripe from 'stripe'
import { NextRequest } from 'next/server'
import { CREDIT_PACKS, CreditPackId } from '@/lib/credits/packs'
import { getAuthenticatedUser } from '@/lib/supabase/auth'
import { getPublicAppUrl } from '@/lib/site'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError, unavailable } = await getAuthenticatedUser(request)
    if (!user) return Response.json({ error: authError }, { status: unavailable ? 503 : 401 })
    if (!process.env.STRIPE_SECRET_KEY) return Response.json({ error: 'Stripe is not configured.' }, { status: 503 })

    const body = (await request.json()) as { packId?: CreditPackId }
    const pack = body.packId ? CREDIT_PACKS[body.packId] : null
    if (!pack) return Response.json({ error: 'Invalid credit pack.' }, { status: 400 })

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const appUrl = getPublicAppUrl(request.nextUrl.origin)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      client_reference_id: user.id,
      success_url: `${appUrl}/?credits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?credits=cancelled`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd', unit_amount: pack.amountCents,
          product_data: { name: pack.name, description: 'Prepaid Moodblendy creative credits' },
        },
      }],
      metadata: { userId: user.id, credits: String(pack.credits), packId: body.packId! },
      payment_intent_data: { metadata: { userId: user.id, credits: String(pack.credits) } },
    })
    if (!session.url) throw new Error('Stripe did not return a Checkout URL.')
    return Response.json({ url: session.url })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not start checkout.' }, { status: 500 })
  }
}
