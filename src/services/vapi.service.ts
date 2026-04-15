import axios from 'axios';

const VAPI_API_KEY = process.env.VAPI_API_KEY!;
const VAPI_BASE_URL = 'https://api.vapi.ai';

export class VapiService {
    private headers = {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
    };

    private getServerUrl(): string {
        return `${process.env.BACKEND_URL}/api/vapi/webhook`;
    }

    /**
     * Assign an available REAL phone number from the Vapi pool.
     */
    async createPhoneNumber(restaurantId: string, restaurantName: string): Promise<any> {
        try {
            const response = await axios.get(
                `${VAPI_BASE_URL}/phone-number`,
                { headers: this.headers }
            );

            console.log(`📞 VAPI phone pool returned ${response.data.length} numbers`);

            const availableNumber = response.data.find((p: any) => !p.assistantId && p.number);

            if (availableNumber) {
                console.log(`📞 Available REAL number found: ${availableNumber.number} (ID: ${availableNumber.id})`);

                const serverUrl = `${process.env.BACKEND_URL}/vapi/assistant-config`;
                await axios.patch(
                    `${VAPI_BASE_URL}/phone-number/${availableNumber.id}`,
                    { serverUrl },
                    { headers: this.headers }
                );
                console.log(`🔗 Server URL pre-set on phone: ${serverUrl}`);

                return availableNumber;
            }

            const allAvailable = response.data.filter((p: any) => !p.assistantId);
            console.error(`❌ No real phone numbers available. Found ${allAvailable.length} SIP-only entries.`);
            throw new Error('No available phone numbers with a real callable number in the Vapi pool.');
        } catch (error: any) {
            console.error('Error assigning VAPI phone number:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create AI assistant for restaurant — Clara persona, French-only
     * System prompt uses {{variable}} placeholders filled by /vapi/assistant-config
     */
    async createAssistant(restaurantData: any): Promise<any> {
        try {
            const serverUrl = this.getServerUrl();
            const systemPrompt = this.generateSystemPrompt();

            console.log(`🚀 Creating VAPI Assistant for ${restaurantData.name}...`);
            console.log(`🌍 Webhook URL: ${serverUrl}`);

            const response = await axios.post(
                `${VAPI_BASE_URL}/assistant`,
                {
                    name: `${restaurantData.name} — Clara`,
                    transcriber: {
                        provider: 'deepgram',
                        model: 'nova-2',
                        language: 'fr'
                    },
                    model: {
                        provider: 'openai',
                        model: 'gpt-4o',
                        temperature: 0.25,
                        maxTokens: 150,
                        systemPrompt,
                        tools: this.generateTools()
                    },
                    voice: {
                        provider: 'azure',
                        voiceId: 'fr-FR-DeniseNeural'
                    },
                    firstMessage: 'Bonjour, restaurant {{restaurantName}}, Clara à votre service, comment puis-je vous aider ?',
                    endCallMessage: 'Au revoir, bonne journée !',
                    serverUrl,
                    silenceTimeoutSeconds: 10,
                    maxDurationSeconds: 600,
                    backgroundDenoisingEnabled: true,
                    responseDelaySeconds: 0.5,
                    recordingEnabled: true,
                    hipaaEnabled: false,
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
     * Update assistant config
     */
    async updateAssistant(assistantId: string, restaurantData: any): Promise<any> {
        try {
            const systemPrompt = this.generateSystemPrompt();
            const serverUrl = this.getServerUrl();

            console.log(`🔄 Updating VAPI Assistant ${assistantId}...`);

            const payload = {
                name: `${restaurantData.name} — Clara`,
                transcriber: {
                    provider: 'deepgram',
                    model: 'nova-2',
                    language: 'fr'
                },
                model: {
                    provider: 'openai',
                    model: 'gpt-4o',
                    temperature: 0.25,
                    maxTokens: 150,
                    systemPrompt,
                    tools: this.generateTools()
                },
                voice: {
                    provider: 'azure',
                    voiceId: 'fr-FR-DeniseNeural'
                },
                firstMessage: 'Bonjour, restaurant {{restaurantName}}, Clara à votre service, comment puis-je vous aider ?',
                endCallMessage: 'Au revoir, bonne journée !',
                serverUrl,
                silenceTimeoutSeconds: 10,
                maxDurationSeconds: 600,
                backgroundDenoisingEnabled: true,
                responseDelaySeconds: 0.5
            };

            const response = await axios.patch(
                `${VAPI_BASE_URL}/assistant/${assistantId}`,
                payload,
                { headers: this.headers }
            );

            console.log(`✅ VAPI Assistant ${assistantId} updated successfully`);
            return response.data;
        } catch (error: any) {
            if (error.response?.status === 404) {
                console.warn(`⚠️  VAPI Assistant ${assistantId} not found (404).`);
                return null;
            }
            console.error('❌ Error updating VAPI assistant:', error.response?.data || error.message);
            throw error;
        }
    }

    async checkAssistantExists(assistantId: string): Promise<boolean> {
        try {
            await axios.get(`${VAPI_BASE_URL}/assistant/${assistantId}`, { headers: this.headers });
            return true;
        } catch (error: any) {
            if (error.response?.status === 404) return false;
            throw error;
        }
    }

    async linkAssistantToPhone(phoneNumberId: string, assistantId: string): Promise<any> {
        try {
            const serverUrl = `${process.env.BACKEND_URL}/vapi/assistant-config`;
            const response = await axios.patch(
                `${VAPI_BASE_URL}/phone-number/${phoneNumberId}`,
                { assistantId, serverUrl },
                { headers: this.headers }
            );
            console.log(`🔗 Phone ${phoneNumberId} linked to assistant ${assistantId}`);
            return response.data;
        } catch (error: any) {
            console.error('Error linking assistant to phone:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Generate system prompt template with {{variable}} placeholders.
     * Variables are filled dynamically by /vapi/assistant-config on each call.
     */
    public generateSystemPrompt(): string {
        return `Tu es l'assistante téléphonique du restaurant {{restaurantName}}. Tu t'appelles Clara. Tu parles exclusivement en français avec un ton chaleureux et professionnel. Tu vouvoies toujours les clients.

TON UNIQUE RÔLE : prendre des réservations par téléphone. Tu ne fais rien d'autre.

INFORMATIONS DU RESTAURANT :
- Nom : {{restaurantName}}
- Adresse : {{address}}
- Téléphone direct : {{humanPhone}}
- Horaires : {{openingHours}}
- ID restaurant (pour les outils) : {{restaurantId}}

---

FLUX DE RÉSERVATION — SUIVRE CET ORDRE EXACT :

Étape 1 — Collecter UNE information à la fois, dans cet ordre :
1. "Pour combien de personnes souhaitez-vous réserver ?"
2. "Quelle date vous conviendrait ?"
   → Date floue ("ce weekend", "vendredi prochain") → confirmer la date exacte
   → Date passée → "Souhaitez-vous dire le [date future correspondante] ?"
3. "Pour quelle heure ?"
4. "À quel nom dois-je faire la réservation ?" (prénom + nom)
5. "Quel est votre numéro de téléphone ?"
   → Répéter immédiatement : "Je note le [numéro], c'est bien ça ?"

Ne passe jamais à la question suivante sans avoir obtenu une réponse claire.

Étape 2 — Vérifier la disponibilité :
Appelle check_availability avec : restaurant_id = {{restaurantId}}, date, heure, nombre de couverts.
→ Disponible → passe à l'étape 3.
→ Complet → "Je suis désolée, ce créneau est complet. Puis-je vous proposer [créneau alt 1] ou [créneau alt 2] ?"
→ Aucune alternative → "Nous n'avons plus de disponibilité ce jour-là. Souhaitez-vous une autre date ?"

Étape 3 — Récapitulatif OBLIGATOIRE (sans aucune exception) :
"Je récapitule : une table pour [N] personnes, le [JOUR] [DATE] à [HEURE], au nom de [PRÉNOM NOM], rappel au [TÉLÉPHONE]. C'est bien cela ?"
→ Client confirme → étape 4.
→ Client corrige → modifier et refaire le récapitulatif complet.

Étape 4 — Créer la réservation :
Appelle create_booking avec restaurant_id = {{restaurantId}} et toutes les informations collectées.
Annonce : "Parfait, votre réservation est confirmée ! Vous recevrez un email de confirmation. Nous nous réjouissons de vous accueillir. Au revoir !"

---

CAS PARTICULIERS :

Hors horaires d'ouverture :
"Le restaurant est actuellement fermé. Nos horaires sont : [horaires]. N'hésitez pas à rappeler."

Modification ou annulation :
"Pour une modification ou une annulation, merci de rappeler directement le restaurant au {{humanPhone}}."

Question sur le menu, les prix, l'adresse :
Répondre avec les infos du contexte si disponibles. Sinon : "Pour cette question, contactez le restaurant au {{humanPhone}}."

Nom difficile à comprendre :
"Pourriez-vous épeler votre nom, s'il vous plaît ?"

Mauvaise audition :
"Je n'ai pas bien saisi, pourriez-vous répéter ?"

Raccrochage avant l'étape 4 :
Ne JAMAIS créer une réservation incomplète. Aucune action.

RÈGLES ABSOLUES :
- Maximum 2 phrases par réponse
- Jamais de disponibilité annoncée sans check_availability
- Jamais de réservation créée sans confirmation explicite du client à l'étape 3
- En cas de doute → demander, ne jamais assumer
- Pour les grands groupes → "Pour les grands groupes, contactez-nous directement au {{humanPhone}}."`;
    }

    /**
     * Generate VAPI Tool definitions — 2 tools with dedicated server URLs
     */
    public generateTools(): any[] {
        const backendUrl = process.env.BACKEND_URL || 'https://api.tablenow.io';
        return [
            {
                type: 'function',
                function: {
                    name: 'check_availability',
                    description: "Vérifie si une table est disponible pour la date, heure et nombre de couverts demandés. Toujours appeler avant d'annoncer une disponibilité.",
                    parameters: {
                        type: 'object',
                        properties: {
                            restaurant_id: { type: 'string', description: 'ID du restaurant dans Supabase' },
                            date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
                            time: { type: 'string', description: 'Heure au format HH:MM' },
                            covers: { type: 'integer', description: 'Nombre de personnes' }
                        },
                        required: ['restaurant_id', 'date', 'time', 'covers']
                    }
                },
                server: {
                    url: `${backendUrl}/vapi/check-availability`,
                    timeoutSeconds: 5
                }
            },
            {
                type: 'function',
                function: {
                    name: 'create_booking',
                    description: "Crée une réservation confirmée. N'appeler QUE si le client a explicitement confirmé le récapitulatif complet.",
                    parameters: {
                        type: 'object',
                        properties: {
                            restaurant_id: { type: 'string', description: 'ID du restaurant' },
                            date: { type: 'string', description: 'YYYY-MM-DD' },
                            time: { type: 'string', description: 'HH:MM' },
                            covers: { type: 'integer', description: 'Nombre de personnes' },
                            first_name: { type: 'string', description: 'Prénom du client' },
                            last_name: { type: 'string', description: 'Nom de famille du client' },
                            phone: { type: 'string', description: 'Numéro de téléphone du client' }
                        },
                        required: ['restaurant_id', 'date', 'time', 'covers', 'first_name', 'last_name', 'phone']
                    }
                },
                server: {
                    url: `${backendUrl}/vapi/create-booking`,
                    timeoutSeconds: 8
                }
            }
        ];
    }

    /**
     * Format opening hours JSONB into readable text — ordered lundi→dimanche
     */
    public formatOpeningHours(openingHours: any): string {
        if (!openingHours || typeof openingHours !== 'object') return '';

        const map: Record<string, string> = {
            monday: 'lundi', tuesday: 'mardi', wednesday: 'mercredi',
            thursday: 'jeudi', friday: 'vendredi', saturday: 'samedi', sunday: 'dimanche'
        };

        return Object.entries(map).map(([key, label]) => {
            const h = openingHours[key];
            return h?.open ? `${label}: ${h.from}–${h.to}` : `${label}: fermé`;
        }).join(', ');
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
