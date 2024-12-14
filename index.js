require('dotenv').config(); // Nạp các biến môi trường từ file .env

const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const ytdl = require('ytdl-core-discord'); // Hoặc 'ytdl-core' nếu bạn muốn dùng bản mới

// Lưu trữ danh sách phát
const queue = new Map();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
});

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Lắng nghe sự kiện khi bot vào voice channel
client.on('messageCreate', async message => {
    if (message.content.startsWith('!play')) {
        const voiceChannel = message.member.voice.channel;

        if (!voiceChannel) {
            return message.reply("You need to join a voice channel first!");
        }

        try {
            // Lấy URL từ tin nhắn
            const url = message.content.split(' ')[1];
            if (!url || !ytdl.validateURL(url)) {
                return message.reply("Please provide a valid YouTube URL.");
            }

            // Lấy hoặc tạo mới queue cho server này
            const serverQueue = queue.get(message.guild.id);

            // Nếu chưa có queue, tạo mới và thêm URL vào danh sách
            if (!serverQueue) {
                const queueConstruct = {
                    voiceChannel,
                    connection: null,
                    player: createAudioPlayer(),
                    songs: [],
                    autoplay: false, // Ban đầu không autoplay
                };

                queue.set(message.guild.id, queueConstruct);
                queueConstruct.songs.push(url);

                try {
                    // Tạo kết nối vào voice channel
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                    });

                    queueConstruct.connection = connection;
                    play(message.guild, queueConstruct.songs[0]);

                } catch (err) {
                    queue.delete(message.guild.id);
                    message.reply("There was an error trying to connect to the voice channel!");
                    throw err;
                }

            } else {
                // Nếu có queue, chỉ cần thêm bài hát vào danh sách
                serverQueue.songs.push(url);
                message.reply(`Added to the queue: ${url}`);
            }

        } catch (err) {
            console.error('Error while playing audio:', err);
            message.reply("There was an error trying to play the audio!");
        }
    }

    if (message.content === '!skip') {
        const serverQueue = queue.get(message.guild.id);
        if (serverQueue && serverQueue.connection) {
            serverQueue.player.stop();
            message.reply("Skipped the current track!");
        } else {
            message.reply("I'm not currently playing anything!");
        }
    }

    if (message.content === '!pause') {
        const serverQueue = queue.get(message.guild.id);
        if (serverQueue && serverQueue.connection) {
            serverQueue.player.pause();
            message.reply("Paused the music!");
        } else {
            message.reply("I'm not currently playing anything!");
        }
    }

    if (message.content === '!resume') {
        const serverQueue = queue.get(message.guild.id);
        if (serverQueue && serverQueue.connection) {
            serverQueue.player.unpause();
            message.reply("Resumed the music!");
        } else {
            message.reply("I'm not currently playing anything!");
        }
    }

    if (message.content === '!stop') {
        const serverQueue = queue.get(message.guild.id);
        if (serverQueue && serverQueue.connection) {
            serverQueue.player.stop();
            serverQueue.connection.disconnect();
            queue.delete(message.guild.id);
            message.reply("Stopped the music and disconnected from the voice channel!");
        } else {
            message.reply("I'm not currently playing anything!");
        }
    }

    if (message.content === '!autoplay') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue) {
            return message.reply("I'm not playing anything right now!");
        }

        serverQueue.autoplay = !serverQueue.autoplay; // Chuyển trạng thái autoplay
        if (serverQueue.autoplay) {
            message.reply("Autoplay is now enabled! I'll play the next song automatically.");
        } else {
            message.reply("Autoplay is now disabled.");
        }
    }
});

// Hàm phát bài hát tiếp theo trong danh sách phát
function play(guild, song) {
    const serverQueue = queue.get(guild.id);

    if (!song) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }

    const stream = ytdl(song, {
        filter: 'audioonly',
        quality: 'highestaudio',
        dlHead: true,
    });

    const resource = createAudioResource(stream, {
        inputType: StreamType.Arbitrary,
    });

    serverQueue.player.play(resource);
    serverQueue.connection.subscribe(serverQueue.player);

    // Lắng nghe khi bài hát kết thúc
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
        if (serverQueue.autoplay && serverQueue.songs.length > 0) {
            const nextSong = serverQueue.songs.shift(); // Lấy bài hát tiếp theo
            play(guild, nextSong);
        } else {
            serverQueue.connection.disconnect();
            queue.delete(guild.id);
        }
    });
}

client.login(process.env.TOKEN);
