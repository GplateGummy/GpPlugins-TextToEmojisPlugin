import "./styles.css";

import definePlugin from "@utils/types";
import { RestAPI, FluxDispatcher, Forms, React, Button, PermissionsBits, ChannelStore, PermissionStore} from "@webpack/common";
import { findByPropsLazy } from "@webpack";
import { Logger } from "@utils/Logger";
import { closeModal, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import { classNameFactory } from "@api/Styles";
import { Margins } from "@utils/margins";

const logger = new Logger("TextToEmojis");
const cl = classNameFactory("vc-tte-");

// Character conversion mapping
const EMOJI_TEXT_MAPPING = {
    "A": "A_", "B": "B_", "C": "C_", "D": "D_", "E": "E_",
    "F": "F_", "G": "G_", "H": "H_", "I": "I_", "J": "J_",
    "K": "K_", "L": "L_", "M": "M_", "N": "N_", "O": "O_",
    "P": "P_", "Q": "Q_", "R": "R_", "S": "S_", "T": "T_",
    "U": "U_", "V": "V_", "W": "W_", "X": "X_", "Y": "Y_",
    "Z": "Z_", " ": "Empty_Space_Nothing_Tab", "?": "QuestionMark",
    "!": "ExclamationMark", "#": "Hashtag", "/": "Slash",
    "@": "AtSign", "$": "DollarSign", ",": "Comma", ".": "Dot",
    ":": "Colon", ")": "RightParentheses", "(": "LeftParentheses",
    "_": "Underscore", "*": "Asterisk", "1": "Number1One",
    "2": "Number2Two", "3": "Number3Three", "4": "Number4Four",
    "5": "Number5Five", "6": "Number6Six", "7": "Number7Seven",
    "8": "Number8Eight", "9": "Number9Nine", "0": "Number0Zero"
};

// Guild IDs mapping
const GUILD_IDS = {
    1: "1339215110685724742",
    2: "1339264485386621078",
    3: "1339265921113391226",
    4: "1339267572931100764",
    5: "1339268634325024800",
    6: "1339272089621889195"
};

// Error messages
const ERROR_MESSAGES = {
    NO_REACT_PERMISSION: "You cannot react in this channel.",
    NO_NITRO: "You need Basic Nitro to use external emojis.",
    NOT_IN_SERVER: "You are not in one of the required servers. Please join: https://discord.gg/GThkG48YA5",
    TOO_MANY_CHARS: "You cannot use the same character more than 6 times.",
    NOT_ENOUGH_GUILDS: (chars) => `The characters '${chars}' appear more frequently than your joined guilds. Please join more servers.`,
    SINGLE_CHAR_LIMIT: (char) => `The character '${char}' appears more frequently than your joined guilds. Please join more servers.`,
    TOO_MANY_CHARS_TOTAL: "Your text cannot exceed 20 characters.",
    INVALID_CHAR: "Your text contains a character that is not permitted.",
    EMPTY_TEXT: "Your text cannot be empty."
};

// Icon for the message hover button
const TextToEmojiIcon = () => {
    return (
        <svg
            aria-hidden="true"
            role="img"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            xmlSpace="preserve"
        >
            <polygon
                fill="currentColor"
                points="3,3 3,7 5,7 5,5 11,5 11,19 9,19 9,21 15,21 15,19 13,19 13,5 19,5 19,7 21,7 21,3 "
            />
        </svg>
    );
};

function hasPermission(channelId: string, permission: bigint) {
    const channel = ChannelStore.getChannel(channelId);

    if (!channel || channel.isPrivate()) return true;

    return PermissionStore.can(permission, channel);
}

const hasExternalEmojiPerms = (channelId: string) => hasPermission(channelId, PermissionsBits.USE_EXTERNAL_EMOJIS);
const hasAddReactionsPerms = (channelId: string) => hasPermission(channelId, PermissionsBits.ADD_REACTIONS);

interface EmojiModalProps {
    rootProps: any;
    close: () => void;
    message: any;
    guilds: any[];
}

function EmojiModal({ rootProps, close, message, guilds: initialGuilds }: EmojiModalProps) {
    const [text, setText] = React.useState("");
    const [error, setError] = React.useState("");
    const [processing, setProcessing] = React.useState(false);
    const [guilds, setGuilds] = React.useState<any[]>([]);
    const [loading, setLoading] = React.useState(true);
    const modalRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
                close();
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [close]);

    React.useEffect(() => {
        const fetchGuilds = async () => {
            try {
                setLoading(true);
                const plugin = window.Vencord?.Plugins?.plugins?.TextToEmojis;
                if (plugin && plugin.getUserGuilds) {
                    const userGuilds = await plugin.getUserGuilds();
                    if (userGuilds && userGuilds.length > 0) {
                        setGuilds(userGuilds);
                    } else {
                        FluxDispatcher.dispatch({
                            type: "NOTICE_CREATE",
                            notice: {
                                message: ERROR_MESSAGES.NOT_IN_SERVER,
                                type: "ERROR"
                            }
                        });
                        close();
                    }
                }
            } catch (error) {
                logger.warn("Error fetching guilds in modal:", error);

                FluxDispatcher.dispatch({
                    type: "NOTICE_CREATE",
                    notice: {
                        message: "Error loading guilds. Please try again.",
                        type: "ERROR"
                    }
                });
                close();
            } finally {
                setLoading(false);
            }
        };

        fetchGuilds();
    }, []);

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setText(e.target.value);
        setError("");
    };

    const handleClear = () => {
        setText("");
        setError("");
    };

    const countCharacters = (str: string) => {
        const charCount: Record<string, number> = {};
        for (const char of str) {
            if (charCount[char]) {
                charCount[char]++;
            } else {
                charCount[char] = 1;
            }
        }
        return charCount;
    };

    const validateText = (input: string) => {
        if (!input.trim()) {
            return ERROR_MESSAGES.EMPTY_TEXT;
        }

        if (input.length > 20) {
            return ERROR_MESSAGES.TOO_MANY_CHARS_TOTAL;
        }

        for (const char of input) {
            const upperChar = char.toUpperCase();
            if (!EMOJI_TEXT_MAPPING[upperChar] && upperChar !== " ") {
                return ERROR_MESSAGES.INVALID_CHAR;
            }
        }

        const charCount = countCharacters(input.toUpperCase());
        const maxCount = Math.max(...Object.values(charCount));

        if (maxCount > 6) {
            return ERROR_MESSAGES.TOO_MANY_CHARS;
        }

        if (maxCount > guilds.length) {
            const charsExceeding = Object.entries(charCount)
                .filter(([_, count]) => count > guilds.length)
                .map(([char]) => char);

            if (charsExceeding.length === 1) {
                return ERROR_MESSAGES.SINGLE_CHAR_LIMIT(charsExceeding[0]);
            } else {
                return ERROR_MESSAGES.NOT_ENOUGH_GUILDS(charsExceeding.join(", "));
            }
        }

        return null;
    };

    const processText = async () => {
        setProcessing(true);
        const upperText = text.toUpperCase();
        const error = validateText(upperText);
        if (error) {
            setError(error);
            setTimeout(() => {
                setProcessing(false);
                setError("");
            }, 3000);
            return;
        }
        try {
            const charCount = countCharacters(upperText);
            const sortedGuilds = [...guilds].sort((a, b) => {
                const indexA = Object.entries(GUILD_IDS).find(([_, id]) => id === a.id)?.[0];
                const indexB = Object.entries(GUILD_IDS).find(([_, id]) => id === b.id)?.[0];
                return parseInt(indexA || "999") - parseInt(indexB || "999");
            });
            const charUsageCount: Record<string, number> = {};
            for (const char of upperText) {
                if (!charUsageCount[char]) {
                    charUsageCount[char] = 0;
                }
                const usageIndex = charUsageCount[char];
                const guildIndex = Math.min(usageIndex, sortedGuilds.length - 1);
                const guild = sortedGuilds[guildIndex];
                const emojiName = EMOJI_TEXT_MAPPING[char];
                const emoji = guild.emojis.find((e: any) => e.name === emojiName);
                if (emoji) {
                    await addReaction(message, `${emoji.name}:${emoji.id}`);
                    logger.info(`Added reaction ${emoji.name} for character ${char}`);
                    await new Promise(resolve => setTimeout(resolve, 350));
                } else {
                    logger.warn(`Could not find emoji ${emojiName} in guild ${guild.id}`);
                }
                charUsageCount[char]++;
            }
            close();
        } catch (err) {
            logger.warn("Error processing text:", err);
            setError("An error occurred while processing. Please try again.");
            setTimeout(() => {
                setProcessing(false);
            }, 3000);
        }
    };

    const addReaction = async (message: any, emoji: string) => {
        try {
            const endpoint = `/channels/${message.channel_id}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}/%40me`;

            await RestAPI.put({
                url: endpoint + "?location=Message%20Reaction%20Picker&type=0",
                oldFormErrors: true
            });

            return true;
        } catch (error) {
            logger.warn(`Failed to add reaction:`, error);
            return false;
        }
    };

    return (
        <ModalRoot {...rootProps}>
            <div ref={modalRef} className={cl("modal-container")}>
                <ModalHeader className={cl("modal-header")}>
                    <Forms.FormTitle tag="h2" className={cl("modal-title")}>
                        Text to Emojis
                    </Forms.FormTitle>
                    <ModalCloseButton onClick={close} className={cl("modal-close-button")} />
                </ModalHeader>
                <ModalContent className={cl("modal-content")}>
                    {error ? (
                        <Forms.FormText className={cl("error-text")}>
                            {error}
                        </Forms.FormText>
                    ) : loading ? (
                        <>
                            <Forms.FormTitle className={cl("title")}>Loading</Forms.FormTitle>
                            <Forms.FormText className={Margins.bottom8}>
                                Loading guild data...
                            </Forms.FormText>
                            <div style={{ height: "48px" }}></div>
                        </>
                    ) : (
                        <>
                            <Forms.FormTitle className={cl("title")}>Enter Text (Max 20 characters)</Forms.FormTitle>
                            <Forms.FormText className={Margins.bottom8}>
                                Your text will be converted to emoji reactions.
                            </Forms.FormText>
                            <textarea
                                className={cl("text-input")}
                                value={text}
                                onChange={handleTextChange}
                                disabled={processing}
                                placeholder="Type your text here..."
                                rows={3}
                                maxLength={20}
                            />
                        </>
                    )}
                </ModalContent>
                <ModalFooter className={cl("modal-footer")}>
                    <Button
                        onClick={close}
                        disabled={processing}
                        className={cl("button-exit")}
                        color={Button.Colors.PRIMARY}
                    >
                        Exit
                    </Button>
                    <Button
                        onClick={handleClear}
                        disabled={processing || loading}
                        className={cl("button-clear")}
                        color={Button.Colors.PRIMARY}
                    >
                        Clear
                    </Button>
                    <div className={cl("spacer")}></div>
                    <Button
                        onClick={processText}
                        disabled={processing || loading || !text.trim()}
                        className={cl("button-confirm")}
                        color={Button.Colors.PRIMARY}
                    >
                        Confirm
                    </Button>
                </ModalFooter>
            </div>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "TextToEmojis",
    description: "Convert text to emoji reactions with a simple UI",
    authors: [{ name: "GplateGam", id: 1278091053836009522n }],

    lastClickTime: 0,
    currentModalKey: null,
    cachedGuilds: [],
    lastGuildCount: 0,

    async start() {
        logger.info("TextToEmojis plugin started");
    },

    stop() {
        logger.info("TextToEmojis plugin stopped");

        if (this.currentModalKey) {
            closeModal(this.currentModalKey);
            this.currentModalKey = null;
        }
    },

    async getUserGuilds() {
        try {
            const guildCountModule = findByPropsLazy("getGuildCount");
            const currentGuildCount = guildCountModule?.getGuildCount() || 0;

            if (this.cachedGuilds.length > 0 && currentGuildCount === this.lastGuildCount) {
                logger.info("Using cached guilds as guild count hasn't changed");
                return this.cachedGuilds;
            }

            this.lastGuildCount = currentGuildCount;

            const targetGuildIds = Object.values(GUILD_IDS);
            const userGuilds = await this.fetchUserGuilds();
            const joinedTargetGuilds = [];

            for (const guild of userGuilds) {
                if (targetGuildIds.includes(guild.id)) {
                    const emojis = await this.fetchGuildEmojis(guild.id);
                    joinedTargetGuilds.push({
                        ...guild,
                        emojis
                    });
                }
            }

            this.cachedGuilds = joinedTargetGuilds;
            return joinedTargetGuilds;
        } catch (error) {
            logger.warn("Failed to get user guilds:", error);
            return [];
        }
    },

    async fetchUserGuilds() {
        try {
            const response = await RestAPI.get({
                url: "/users/@me/guilds"
            });

            return response.body;
        } catch (error) {
            logger.warn("Failed to fetch user guilds:", error);
            return [];
        }
    },

    async fetchGuildEmojis(guildId: string) {
        try {
            const response = await RestAPI.get({
                url: `/guilds/${guildId}/emojis`
            });

            return response.body;
        } catch (error) {
            logger.warn(`Failed to fetch emojis for guild ${guildId}:`, error);
            return [];
        }
    },

    renderMessagePopoverButton(message: any) {
        if (!hasAddReactionsPerms(message.channel_id)) {
            return;
        }
        
        return {
            label: "Text to Emojis",
            icon: TextToEmojiIcon,
            message: message,
            onClick: async () => {
                logger.info(`Button clicked for message ${message?.id}`);

                const currentTime = Date.now();
                if (currentTime - this.lastClickTime < 250) {
                    logger.info("Button on cooldown, ignoring click");
                    return;
                }
                this.lastClickTime = currentTime;

                if (this.currentModalKey) {
                    logger.info("Modal already open, closing it");
                    closeModal(this.currentModalKey);
                    this.currentModalKey = null;
                    return;
                }

                if (!hasAddReactionsPerms(message.channel_id)) {
                    FluxDispatcher.dispatch({
                        type: "NOTICE_CREATE",
                        notice: {
                            message: ERROR_MESSAGES.NO_REACT_PERMISSION,
                            type: "ERROR"
                        }
                    });
                    return;
                }

                if (!hasExternalEmojiPerms(message.channel_id)) {
                    FluxDispatcher.dispatch({
                        type: "NOTICE_CREATE",
                        notice: {
                            message: ERROR_MESSAGES.NO_NITRO,
                            type: "ERROR"
                        }
                    });
                    return;
                }

                const key = openModal(props => (
                    <EmojiModal
                        rootProps={props}
                        close={() => {
                            closeModal(key);
                            this.currentModalKey = null;
                        }}
                        message={message}
                        guilds={[]}
                    />
                ));

                this.currentModalKey = key;
            }
        };
    }
});
