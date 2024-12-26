require('dotenv').config();
const { SlashCommandBuilder } = require('@discordjs/builders');
const { EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const ytSearch = require('yt-search');
const SpotifyWebApi = require('spotify-web-api-node');

const { youtubeApiKey, spotify } = require('../config/config');
const API_KEY = youtubeApiKey;
const spotifyApi = new SpotifyWebApi({
  clientId: spotify.clientId,
  clientSecret: spotify.clientSecret,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Tìm kiếm và phát nhạc từ YouTube hoặc Spotify.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('Tìm kiếm và phát bài hát.')
        .addStringOption(option =>
          option.setName('query')
            .setDescription('Bài hát bạn muốn tìm kiếm')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('spotify')
        .setDescription('Phát bài hát hoặc danh sách phát từ Spotify.')
        .addStringOption(option =>
          option.setName('url')
            .setDescription('URL của bài hát hoặc danh sách phát Spotify')
            .setRequired(true))),


  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const query = interaction.options.getString('query') || interaction.options.getString('url');
    const channel = interaction.member.voice.channel;

    if (!channel) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 Bạn cần ở trong một kênh thoại để phát nhạc.')],
        ephemeral: true,
      });
    }

    try {
      await interaction.deferReply();

      if (subcommand === 'search') {
        const searchResult = await ytSearch(query);
        if (!searchResult || !searchResult.videos.length) {
          return interaction.followUp({ 
            embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 Không tìm thấy bài hát nào cho yêu cầu của bạn.')],
          });
        }

        const selectedVideo = searchResult.videos[0];
        await interaction.client.playerManager.distube.play(channel, selectedVideo.url, {
          member: interaction.member,
          textChannel: interaction.channel,
        });

        await interaction.followUp({
          embeds: [new EmbedBuilder().setColor('#FF00FF').setDescription(`🎶 Đã thêm vào danh sách phát: **${selectedVideo.title}**`)],
        });
      }

      if (subcommand === 'spotify') {
        try {
          const accessToken = await spotifyApi.clientCredentialsGrant();
          spotifyApi.setAccessToken(accessToken.body['access_token']);
          const trackIds = query.split(/track\/|playlist\//).filter(Boolean);
          const trackNames = [];

          if (trackIds.length > 0) {
            for (const id of trackIds) {
              const trackInfo = await spotifyApi.getTrack(id);
              trackNames.push(`${trackInfo.body.name} - ${trackInfo.body.artists[0].name}`);
            }
          }

          const queuedTracks = [];
          const videoUrls = [];

          for (const trackName of trackNames) {
            try {
              const searchResult = await ytSearch(trackName);
              if (searchResult && searchResult.videos.length > 0) {
                const video = searchResult.videos[0];
                videoUrls.push(video.url);
                queuedTracks.push(video.title);
              }
            } catch (error) {
              console.error(error);
              await interaction.followUp({
                embeds: [new EmbedBuilder().setColor('#FF0000').setDescription(`🚫 Lỗi khi thêm bài hát: **${trackName}**`)],
              });
            }
          }

          if (queuedTracks.length > 0) {
            await interaction.client.playerManager.distube.play(channel, videoUrls[0], {
              member: interaction.member,
              textChannel: interaction.channel,
              skip: true,
            });

            for (let i = 1; i < videoUrls.length; i++) {
              await interaction.client.playerManager.distube.play(channel, videoUrls[i], {
                member: interaction.member,
                textChannel: interaction.channel,
                skip: false,
              });
            }

            await interaction.followUp({
              embeds: [new EmbedBuilder().setColor('#FF00FF').setDescription(`🎶 Đã thêm **${queuedTracks.length}** bài hát từ Spotify.`)],
            });
          } else {
            await interaction.followUp({
              embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 Không tìm thấy bài hát hợp lệ từ Spotify.')],
            });
          }
        } catch (error) {
          console.error(error);
          await interaction.followUp({
            embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('🚫 Đã xảy ra lỗi khi kết nối đến Spotify.')],
          });
        }
      }
    } catch (error) {
      console.error(error);
      await interaction.followUp({
        embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 Đã xảy ra lỗi khi xử lý yêu cầu của bạn.')],
      });
    }
  },
};
