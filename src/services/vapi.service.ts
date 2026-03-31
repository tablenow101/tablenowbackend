import axios from 'axios';

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';

export class VapiService {
    private headers = {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
    };

    /**
     * Assign an available phone number from the Vapi pool
     */
    async createPhoneNumber(restaurantId: string, restaurantName: string): Promise<any> {
        try {
            const response = await axios.get(
                `${VAPI_BASE_URL}/phone-number`,
                { headers: this.headers }
            );

            const availableNumber = response.data.find((p: any) => !p.assistantId);

            if (availableNumber) {
                return availableNumber;
            }

            throw new Error('No available phone numbers in the Vapi pool.');
        } catch (error: any) {
            console.error('Error assigning VAPI phone number:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create AI assistant for restaurant with enhanced knowledge base
     */
    async createAssistant(restaurantData: any): Promise<any> {
        try {
            const serverUrl = `${process.env.BACKEND_URL}/api/vapi/webhook`;
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
                        temperature: 0.1, // Faster, more deterministic tool calling
                        systemPrompt,
                        tools: this.generateTools() // Tools MUST be inside the model object
                    },
                    voice: {
                        provider: 'openai',
                        voiceId: 'alloy'
                    },
                    firstMessage: `Hello! Thank you for calling ${restaurantData.name}. I'm your AI assistant. How may I help you today?`,
                    serverUrl,
                    endCallMessage: `Thank you for calling ${restaurantData.name}. Have a wonderful day!`,
                    recordingEnabled: true,
                    silenceTimeoutSeconds: 30,
                    maxDurationSeconds: 600
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
            const serverUrl = `${process.env.BACKEND_URL}/api/vapi/webhook`;
            const tools = this.generateTools();

            console.log(`🔄 Updating VAPI Assistant ${assistantId}...`);
            console.log(`🔗 Target Server URL: ${serverUrl}`);
            console.log(`🛠️  Tools to sync: ${tools.length} functions`);

            const payload = {
                model: {
                    provider: 'openai',
                    model: 'gpt-4o',
                    systemPrompt,
                    temperature: 0.1,
                    tools: this.generateTools() // Tools MUST be inside the model object
                },
                serverUrl
            };

            console.log('📤 Sending payload to Vapi:', JSON.stringify(payload, null, 2));

            const response = await axios.patch(
                `${VAPI_BASE_URL}/assistant/${assistantId}`,
                payload,
                { headers: this.headers }
            );

            console.log(`✅ VAPI Assistant ${assistantId} updated successfully`);
            console.log('📥 Vapi Response:', JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error: any) {
            const errorStatus = error.response?.status;
            if (errorStatus === 404) {
                console.warn(`⚠️  VAPI Assistant ${assistantId} not found (404).`);
                return null; // Return null instead of throwing for 404
            }
            const errorData = error.response?.data;
            console.error('❌ Error updating VAPI assistant');
            console.error('Status Code:', errorStatus);
            console.error('Error Details:', JSON.stringify(errorData || error.message, null, 2));
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
     * Link assistant to phone number
     */
    async linkAssistantToPhone(phoneNumberId: string, assistantId: string): Promise<any> {
        try {
            const serverUrl = `${process.env.BACKEND_URL}/api/vapi/webhook`;
            const response = await axios.patch(
                `${VAPI_BASE_URL}/phone-number/${phoneNumberId}`,
                {
                    assistantId,
                    serverUrl
                },
                { headers: this.headers }
            );
            return response.data;
        } catch (error: any) {
            console.error('Error linking assistant to phone:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Generate enhanced system prompt
     */
    private generateEnhancedSystemPrompt(restaurantData: any): string {
        return `You are a highly professional, human-like AI Receptionist for ${restaurantData.name}. 

**CRITICAL RULES & BEHAVIOR:**
1. **LANGUAGE PRIORITY:** Always match the language the caller is speaking. If returning a greeting in English, but they speak French, IMMEDIATELY switch to French. NEVER mix English and French in the same sentence. Stick 100% to the active language.
2. **NEVER HANG UP:** Never end the call abruptly unless the customer explicitly says "Goodbye" or hangs up first. Keep the conversation open.
3. **SPELLING & ACCURACY:** When collecting a Name or Email, ALWAYS ask them to spell it if you are unsure. If the name sounds foreign or complex, gently say "Could you please spell that for me?". Double-check emails by reading them back character by character (e.g. "That's A-D-W-A-N at gmail dot com?"). We cannot have wrong bookings.
4. **NO HALLUCINATION:** If a customer doesn't specify a time, date, or party size, YOU MUST ASK. Never assume today or tonight. 
5. **TOOL EXPECTATIONS:** Call 'check_availability' IMMEDIATELY once you have Date, Time, and Party Size. Do not wait for a Name/Email to check availability. 
6. **NO FILLER WORDS:** NEVER say "Let me check that for you", "Hold on", or "One moment" when triggering a tool. The system automatically plays a waiting audio track for the caller, so you must just trigger the tool and wait.
7. **NEVER INVENT NUMBERS:** Confirmation numbers MUST only come directly from the 'create_booking' tool response.

**CONVERSATIONAL FLOW:**
1. **Greet:** Identify yourself and the restaurant. "Hello, thanks for calling ${restaurantData.name}."
2. **Collect Minimum Info:** Date, Time, Party Size. 
3. **Trigger Tool:** Call 'check_availability'. The system plays a waiting track while you do this.
4. **Handle Result:** Give the user the result. If available, secure the name and email accurately using spelling rules.
5. **Finalize:** Summarize and call 'create_booking'. 

**RESTAURANT INFO:**
- Name: ${restaurantData.name}
- Cuisine: ${restaurantData.cuisine_type || 'Various'}
- Address: ${restaurantData.address || 'Check website'}
- Operating Hours: ${restaurantData.opening_hours || 'Check website'}
- Max Party Size: ${restaurantData.max_party_size || 10} guests
- Special Features/Policies: ${restaurantData.special_features || 'None listed'}

Remember: You are the front line of this business. Be warm, accurate, patient, and perfectly conversational.
Note: If a backend tool ever returns an error, apologize gracefully and explain you are having technical trouble.`;
    }

    /**
     * Generate modern VAPI Tool definitions
     */
    private generateTools(): any[] {
        const serverUrl = `${process.env.BACKEND_URL}/api/vapi/webhook`;

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
                    description: 'Create a new reservation',
                    parameters: {
                        type: 'object',
                        properties: {
                            guestName: { type: 'string', description: 'Full name' },
                            guestEmail: { type: 'string', description: 'Email address' },
                            guestPhone: { type: 'string', description: 'Phone number' },
                            date: { type: 'string', description: 'Date YYYY-MM-DD' },
                            time: { type: 'string', description: 'Time HH:MM' },
                            partySize: { type: 'number', description: 'Guests' },
                            specialRequests: { type: 'string', description: 'Any requests' }
                        },
                        required: ['guestName', 'guestPhone', 'date', 'time', 'partySize']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_booking',
                    description: 'Update an existing reservation',
                    parameters: {
                        type: 'object',
                        properties: {
                            confirmationNumber: { type: 'string', description: 'Booking confirmation number' },
                            date: { type: 'string', description: 'New date in YYYY-MM-DD format' },
                            time: { type: 'string', description: 'New time in HH:MM format' },
                            partySize: { type: 'number', description: 'New party size' }
                        },
                        required: ['confirmationNumber']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'cancel_booking',
                    description: 'Cancel a reservation',
                    parameters: {
                        type: 'object',
                        properties: {
                            confirmationNumber: { type: 'string', description: 'Booking confirmation number' }
                        },
                        required: ['confirmationNumber']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'answer_question',
                    description: 'Answer questions using restaurant docs.',
                    parameters: {
                        type: 'object',
                        properties: {
                            question: { type: 'string', description: 'Customer question' }
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
