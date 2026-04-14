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
                        voiceId: 'charlotte',
                        stability: 0.55,
                        similarityBoost: 0.80,
                        style: 0.3
                    },
                    firstMessage: `Bonjour, ${restaurantData.name}, j'écoute !`,
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
     * Generate system prompt — natural, French-first, concise
     */
    public generateEnhancedSystemPrompt(restaurantData: any): string {
        const maxCovers = restaurantData.max_covers || restaurantData.max_party_size || 10;
        const cuisine = restaurantData.cuisine_type || '';
        const address = restaurantData.address || '';

        return `Tu es la réceptionniste vocale de ${restaurantData.name}${cuisine ? ', ' + cuisine : ''}${address ? ', ' + address : ''}. Tu sonnes comme une vraie personne — chaleureuse, naturelle, efficace.

## LANGUE
Détecte la langue dès la première phrase et réponds UNIQUEMENT dans cette langue jusqu'à la fin. Si l'appelant parle français → français. Si anglais → anglais. Ne mélange jamais.

## PERSONNALITÉ
- Ton chaud et direct, comme un bon maître d'hôtel
- Phrases courtes. Pas de remplissage. Pas de "bien sûr", "absolument", "pas de souci" en boucle
- Naturel : "On a de la place !" plutôt que "Nous avons la disponibilité requise"
- Jamais robotique. Jamais corporate

## FLUX DE RÉSERVATION (dans cet ordre exact)

**Étape 1 — Identifier l'intention**
Écoute. L'appelant veut réserver, modifier, annuler, ou poser une question ?

**Étape 2 — Collecter les 3 infos (naturellement, pas comme un formulaire)**
- Date → Heure → Nombre de couverts
- Exemple : "Pour quand ? … À quelle heure ? … Vous serez combien ?"
- Ne demande PAS le nom ni l'email à ce stade

**Étape 3 — Vérifier la dispo (IMMÉDIATEMENT)**
Dès que tu as les 3 infos → appelle \`check_availability\`. Ne dis pas "je vérifie", appelle directement.

**Étape 4 — Si disponible**
"Parfait, j'ai une table pour vous ! C'est à quel nom ?" → puis numéro de téléphone → email (optionnel)

**Étape 5 — Confirmer et réserver**
Récapitule : "Donc [nom], [couverts] personnes le [date] à [heure], c'est bien ça ?" → appelle \`create_booking\` → donne le numéro de confirmation du tool

**Étape 6 — Conclure**
"C'est tout bon ! On vous attend [prénom]. À bientôt !"

## RÈGLES ABSOLUES (ne jamais enfreindre)
- **Ne jamais raccrocher en premier** — toujours attendre que l'appelant dise au revoir
- **Ne jamais inventer un numéro de confirmation** — il vient UNIQUEMENT de la réponse du tool \`create_booking\`
- **Ne pas dire "je vérifie" ou "un instant"** avant un tool call — appelle le tool directement, le silence est géré
- **Si un tool renvoie une erreur** → "J'ai un petit problème technique là, pouvez-vous rappeler dans un instant ?"
- **Prénoms difficiles** → "Vous pouvez épeler ?"
- **Emails** → épelle lettre par lettre avant de confirmer : "Donc c'est M-A-R-C à gmail point com, c'est ça ?"
- **Si le créneau est complet** → propose une alternative : autre heure, autre jour
- **Pour les groupes de plus de ${maxCovers} personnes** → "Pour les grands groupes, je vous recommande de nous appeler directement pour qu'on s'organise au mieux"

## INFOS RESTAURANT
- Nom : ${restaurantData.name}
${cuisine ? '- Cuisine : ' + cuisine : ''}
${address ? '- Adresse : ' + address : ''}
- Capacité max par réservation : ${maxCovers} couverts

## CAS PARTICULIERS
- Question sur le menu, les horaires, etc. → tool \`answer_question\`
- Demande à parler à un humain → "Bien sûr, je cherche quelqu'un." (ne pas raccrocher)
- Modification de résa → tool \`update_booking\` avec le numéro de confirmation
- Annulation → tool \`cancel_booking\` avec le numéro de confirmation

Tu représentes ce restaurant. Chaque appel est une opportunité de fidéliser un client.`;
    }

    /**
     * Generate VAPI Tool definitions
     */
    public generateTools(): any[] {
        return [
            {
                type: 'function',
                function: {
                    name: 'check_availability',
                    description: 'Vérifie si une table est disponible pour une date, heure et nombre de couverts donnés. Appelle ce tool dès que tu as les 3 informations.',
                    parameters: {
                        type: 'object',
                        properties: {
                            date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
                            time: { type: 'string', description: 'Heure au format HH:MM (24h)' },
                            partySize: { type: 'number', description: 'Nombre de couverts' }
                        },
                        required: ['date', 'time', 'partySize']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'create_booking',
                    description: "Crée la réservation après confirmation orale de tous les détails. Appelle ce tool uniquement après avoir récapitulé et obtenu l'accord du client.",
                    parameters: {
                        type: 'object',
                        properties: {
                            guestName: { type: 'string', description: 'Nom complet du client' },
                            guestPhone: { type: 'string', description: 'Numéro de téléphone' },
                            guestEmail: { type: 'string', description: 'Email (optionnel)' },
                            date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
                            time: { type: 'string', description: 'Heure au format HH:MM (24h)' },
                            partySize: { type: 'number', description: 'Nombre de couverts' },
                            specialRequests: { type: 'string', description: 'Demandes spéciales ou allergies' }
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
