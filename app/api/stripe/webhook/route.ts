import Stripe from 'stripe'
import { createServiceSupabaseClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  if (!signature) return Response.json({ error: 'Missing Stripe signature.' }, { status: 400 })
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return Response.json({ error: 'Stripe webhook is not configured.' }, { status: 503 })
  }

  let event: Stripe.Event
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    event = stripe.webhooks.constructEvent(await request.text(), signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid webhook.' }, { status: 400 })
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.payment_status !== 'paid') return Response.json({ received: true })
      const userId = session.metadata?.userId
      const credits = Number(session.metadata?.credits)
      if (!userId || !Number.isInteger(credits) || credits <= 0) throw new Error('Checkout metadata is invalid.')

      const { error } = await createServiceSupabaseClient().rpc('grant_purchased_credits', {
        p_user_id: userId,
        p_stripe_checkout_session_id: session.id,
        p_credits: credits,
        p_amount_total: session.amount_total ?? 0,
        p_currency: session.currency ?? 'usd',
        p_metadata: { customer: session.customer, payment_intent: session.payment_intent },
      })
      if (error) throw error
    }
    return Response.json({ received: true })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Webhook handling failed.' }, { status: 500 })
  }
}
