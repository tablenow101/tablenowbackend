import axios from 'axios';

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';

export class VapiService {
    private headers = {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
    };

    /**
     * Get the canonical webhook URL (single source of truth)
     */
    private getServerUrl(): string {
        return `${process.env.BACKEND_URL}/api/vapi/webhook`;
    }

    /**
     * Assign an available REAL phone number from the Vapi pool.
     * Skips SIP-only entries that have no callable number.
     * ALSO sets the serverUrl on the phone immediately so it never points to example.com.
     */
    async createPhoneNumber(restaurantId: string, restaurantName: string): Promise<any> {
        try {
            const response = await axios.get(
                `${VAPI_BASE_URL}/phone-number`,
                { headers: this.headers }
            );

            console.log(`📞 VAPI phone pool returned ${response.data.length} numbers`);

            // CRITICAL: Only pick phone numbers that have a real callable number (e.g. +14125381947)
            const availableNumber = response.data.find((p: any) => !p.assistantId && p.number);

            if (availableNumber) {
                console.log(`📞 Available REAL number found: ${availableNumber.number} (ID: ${availableNumber.id})`);

                // IMMEDIATELY set the correct server URL on the phone number
                // This prevents the "example.com" bug from ever occurring again
                const serverUrl = this.getServerUrl();
                await axios.patch(
                    `${VAPI_BASE_URL}/phone-number/${availableNumber.id}`,
                    { serverUrl },
                    { headers: this.headers }
                );
                console.log(`🔗 Server URL pre-set on phone: ${serverUrl}`);

                return availableNumber;
            }

            // If no real number is available, log diagnostics
            const allAvailable = response.data.filter((p: any) => !p.assistantId);
            console.error(`❌ No real phone numbers available. Found ${allAvailable.length} SIP-only entries.`);
            allAvailable.forEach((p: any) => console.log(`   SIP: ${p.name || p.id}`));

            throw new Error('No available phone numbers with a real callable number in the Vapi pool. Please purchase more numbers in your Vapi dashboard.');
        } catch (error: any) {
            console.error('Error assigning VAPI phone number:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create AI assistant for restaurant with world-class conversational prompt
     */
    async createAssistant(restaurantData: any): Promise<any> {
        try {
            const serverUrl = this.getServerUrl();
            const systemPrompt = this.generateEnhancedSystemPrompt(restaurantData);

            console.log(`🚀 Creating VAPI Assistant for ${restaurantData.name}...`);
            console.log(`🌍 Webhook URL: ${serverUrl}`);

            const response = await axios.post(
                `${VAPI_BASE_URL}/assistant`,
                {
                    name: `${restaurantData.name} AI Receptionist`,
                    model: {
                        provider: 'openai',
                        model: 'gpt-4o',
                        temperature: 0.3,
                        systemPrompt,
                        tools: this.generateTools()
                    },
                    voice: {
                        provider: '11labs',
                        voiceId: 'sarah',
                        stability: 0.5,
                        similarityBoost: 0.75
                    },
                    firstMessage: `Hi there, thank you for calling ${restaurantData.name}! How can I help you today?`,
                    serverUrl,
                    endCallMessage: `Thank you so much for calling ${restaurantData.name}. We look forward to seeing you! Goodbye.`,
                    recordingEnabled: true,
                    silenceTimeoutSeconds: 30,
                    maxDurationSeconds: 600,
                    backgroundSound: 'office',
                    backchannelingEnabled: true,
                    backgroundDenoisingEnabled: true,
                    modelOutputInMessagesEnabled: true
                },
                { headers: this.headers }
            );
            return response.data;
        } catch (error: any) {
            console.error('Error creating VAPI assistant:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Update assistant with new restaurant data and sync tools
     */
    async updateAssistant(assistantId: string, restaurantData: any): Promise<any> {
        try {
            const systemPrompt = this.generateEnhancedSystemPrompt(restaurantData);
            const serverUrl = this.getServerUrl();

            console.log(`🔄 Updating VAPI Assistant ${assistantId}...`);
            console.log(`🔗 Target Server URL: ${serverUrl}`);

            const payload = {
                model: {
                    provider: 'openai',
                    model: 'gpt-4o',
                    systemPrompt,
                    temperature: 0.3,
                    tools: this.generateTools()
                },
                serverUrl
            };

            const response = await axios.patch(
                `${VAPI_BASE_URL}/assistant/${assistantId}`,
                payload,
                { headers: this.headers }
            );

            console.log(`✅ VAPI Assistant ${assistantId} updated successfully`);
            return response.data;
        } catch (error: any) {
            const errorStatus = error.response?.status;
            if (errorStatus === 404) {
                console.warn(`⚠️  VAPI Assistant ${assistantId} not found (404).`);
                return null;
            }
            console.error('❌ Error updating VAPI assistant:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Check if assistant exists on VAPI
     */
    async checkAssistantExists(assistantId: string): Promise<boolean> {
        try {
            await axios.get(`${VAPI_BASE_URL}/assistant/${assistantId}`, { headers: this.headers });
            return true;
        } catch (error: any) {
            if (error.response?.status === 404) return false;
            throw error;
        }
    }

    /**
     * Link assistant to phone number AND set server URL (belt-and-suspenders)
     */
    async linkAssistantToPhone(phoneNumberId: string, assistantId: string): Promise<any> {
        try {
            const serverUrl = this.getServerUrl();
            const response = await axios.patch(
                `${VAPI_BASE_URL}/phone-number/${phoneNumberId}`,
                {
                    assistantId,
                    serverUrl
                },
                { headers: this.headers }
            );
            console.log(`🔗 Phone ${phoneNumberId} linked to assistant ${assistantId} with serverUrl ${serverUrl}`);
            return response.data;
        } catch (error: any) {
            console.error('Error linking assistant to phone:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Generate world-class system prompt — inspired by Slang AI / top restaurant AI companies
     */
    public generateEnhancedSystemPrompt(restaurantData: any): string {
        return `You are the AI Receptionist for ${restaurantData.name}. You sound like a real, friendly human — not robotic.

## YOUR PERSONALITY
- You are warm, confident, and efficient — like a top-tier restaurant host who genuinely enjoys helping people.
- You speak naturally with contractions ("I'd love to", "That's great!", "We'd be happy to").
- You are concise. You never ramble. Every sentence has a purpose.
- You match the caller's energy — if they're excited, match it; if they're calm, be calm.
- You NEVER sound like a chatbot. No corporate jargon. No "I understand your concern." Just be real.

## LANGUAGE RULES (CRITICAL)
- Detect the caller's language from their FIRST sentence and respond ONLY in that language for the ENTIRE call.
- If they speak French, respond ENTIRELY in French. If English, ENTIRELY in English. NEVER mix languages.
- If you are unsure of the language, politely ask: "Would you prefer English or French?"

## CALL FLOW
1. **Greeting**: Keep it short and warm. "Hi, thanks for calling ${restaurantData.name}! How can I help?"
2. **Identify Intent**: Are they booking, modifying, cancelling, or asking a question?
3. **For Reservations** — collect these three things naturally (don't interrogate):
   - What date?
   - What time?
   - How many guests?
4. **Check Availability**: Once you have date, time, and party size → immediately call 'check_availability'. Do NOT collect name/email first.
5. **If Available**: "Great news, we have a table! Can I get a name for the reservation?" → then ask for email/phone.
6. **Confirm & Book**: Read back ALL details → call 'create_booking' → give them the confirmation number from the tool response.
7. **Wrap Up**: "You're all set! We look forward to seeing you. Is there anything else I can help with?"

## ABSOLUTE RULES (NEVER BREAK THESE)
- **NEVER hang up first.** Always wait for the caller to say goodbye.
- **NEVER assume dates.** If they say "tomorrow" you MUST use today's date (injected by the system) to calculate tomorrow. Never guess.
- **NEVER invent confirmation numbers.** They ONLY come from the 'create_booking' tool response.
- **NEVER say "Let me check" or "One moment" or "Hold on please."** When you call a tool, the system automatically handles the silence. Just call the tool.
- **NEVER hallucinate information.** If the tool returns an error or you don't know something, say: "I'm sorry, I'm having a small technical issue. Would you like me to have someone from the team call you back?"
- **Spelling**: For names that sound unusual, ask: "Could you spell that for me?" For emails, always read them back letter by letter: "So that's M-A-R-C-U-S at gmail dot com, correct?"
- **Phone numbers**: If the caller ID already provides their phone, do NOT ask for it again.

## RESTAURANT INFORMATION
- Restaurant: ${restaurantData.name}
- Cuisine: ${restaurantData.cuisine_type || 'Fine Dining'}
- Address: ${restaurantData.address || 'Please check our website'}
- Hours: ${restaurantData.opening_hours || restaurantData.special_features || 'Please check our website'}
- Maximum party size: ${restaurantData.max_party_size || 10} guests
- Cancellation policy: ${restaurantData.cancellation_policy || '24 hours notice required'}
- Special features: ${restaurantData.special_features || 'None specified'}

## HANDLING EDGE CASES
- If they ask about the menu → use the 'answer_question' tool.
- If the party size exceeds the maximum → politely say: "For parties larger than ${restaurantData.max_party_size || 10}, I'd recommend reaching out to us directly so we can make special arrangements for you."
- If they want to speak to a human → "Of course! Let me see if someone is available." (Do NOT end the call.)
- If the date is fully booked → "Unfortunately we're fully booked that evening. Would you like to try a different date or time?"

Remember: You represent this restaurant. Every call is an opportunity to make someone's day better.`;
    }

    /**
     * Generate VAPI Tool definitions
     */
    private generateTools(): any[] {
        return [
            {
                type: 'function',
                function: {
                    name: 'check_availability',
                    description: 'Check if tables are available for a specific date, time, and party size',
                    parameters: {
                        type: 'object',
                        properties: {
                            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
                            time: { type: 'string', description: 'Time in HH:MM format (24-hour)' },
                            partySize: { type: 'number', description: 'Number of guests' }
                        },
                        required: ['date', 'time', 'partySize']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'create_booking',
                    description: 'Create a new reservation after confirming all details with the caller',
                    parameters: {
                        type: 'object',
                        properties: {
                            guestName: { type: 'string', description: 'Full name of the guest' },
                            guestEmail: { type: 'string', description: 'Email address' },
                            guestPhone: { type: 'string', description: 'Phone number' },
                            date: { type: 'string', description: 'Reservation date in YYYY-MM-DD format' },
                            time: { type: 'string', description: 'Reservation time in HH:MM format (24-hour)' },
                            partySize: { type: 'number', description: 'Number of guests' },
                            specialRequests: { type: 'string', description: 'Any special requests or dietary needs' }
                        },
                        required: ['guestName', 'guestPhone', 'date', 'time', 'partySize']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_booking',
                    description: 'Update an existing reservation by confirmation number',
                    parameters: {
                        type: 'object',
                        properties: {
                            confirmationNumber: { type: 'string', description: 'Booking confirmation number' },
                            date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
                            time: { type: 'string', description: 'New time in HH:MM format (24-hour)' },
                            partySize: { type: 'number', description: 'Updated party size' }
                        },
                        required: ['confirmationNumber']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'cancel_booking',
                    description: 'Cancel a reservation by confirmation number',
                    parameters: {
                        type: 'object',
                        properties: {
                            confirmationNumber: { type: 'string', description: 'Booking confirmation number to cancel' }
                        },
                        required: ['confirmationNumber']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'answer_question',
                    description: 'Answer questions about the restaurant using knowledge base documents (menu, policies, FAQs)',
                    parameters: {
                        type: 'object',
                        properties: {
                            question: { type: 'string', description: 'The customer question to answer' }
                        },
                        required: ['question']
                    }
                }
            }
        ];
    }

    async deletePhoneNumber(phoneNumberId: string): Promise<void> {
        try {
            await axios.delete(`${VAPI_BASE_URL}/phone-number/${phoneNumberId}`, { headers: this.headers });
        } catch (error: any) {
            console.error('Error deleting phone number:', error.response?.data || error.message);
            throw error;
        }
    }

    async deleteAssistant(assistantId: string): Promise<void> {
        try {
            await axios.delete(`${VAPI_BASE_URL}/assistant/${assistantId}`, { headers: this.headers });
        } catch (error: any) {
            console.error('Error deleting assistant:', error.response?.data || error.message);
            throw error;
        }
    }
}

export default new VapiService();
