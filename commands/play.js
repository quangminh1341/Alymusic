require('dotenv').config();
const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const { google } = require('googleapis');
const yt = google.youtube('v3');
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
    .setDescription('Search and play a song or playlist.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('Search for and play a song.')
        .addStringOption(option =>
          option.setName('query')
            .setDescription('The song to search for')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('playlist')
        .setDescription('Play a playlist from YouTube.')
        .addStringOption(option =>
          option.setName('url')
            .setDescription('The URL of the YouTube playlist')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('spotify')
        .setDescription('Play a song or playlist from Spotify.')
        .addStringOption(option =>
          option.setName('url')
            .setDescription('The URL of the Spotify track or playlist')
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

      if (subcommand === 'playlist') {
        const playlistIdMatch = query.match(/list=([^&]+)/);
        if (playlistIdMatch) {
          const playlistId = playlistIdMatch[1];

          const playlistResponse = await yt.playlistItems.list({
            key: API_KEY,
            part: 'snippet',
            playlistId: playlistId,
            maxResults: 50,
          });

          const videos = playlistResponse.data.items;

          if (videos.length === 0) {
            return interaction.followUp({
              embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 Không tìm thấy video nào trong danh sách phát.')],
            });
          }

          const videoUrls = videos.map(video => `https://www.youtube.com/watch?v=${video.snippet.resourceId.videoId}`);

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
            embeds: [
              new EmbedBuilder()
                .setColor('#FF00FF')
                .setDescription(`🎶 Đã thêm **${videos.length}** bài hát từ danh sách phát.`),
            ],
          });
          return;
        } else {
          return interaction.followUp({
            embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 URL danh sách phát không hợp lệ.')],
          });
        }
      }

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

      } else if (subcommand === 'spotify') {
        const isSpotifyPlaylist = query.includes('playlist');
        const isSpotifyTrack = query.includes('track');
        const isSpotifyAlbum = query.includes('album');
        const isSpotifyArtist = query.includes('artist');
        const isSpotifyCollection = query.includes('collection');

        if (isSpotifyPlaylist || isSpotifyTrack || isSpotifyAlbum || isSpotifyArtist || isSpotifyCollection) {
          try {
            const accessToken = await spotifyApi.clientCredentialsGrant().then(
              data => data.body['access_token'],
              error => {
                throw new Error('SpotifyAccessError');
              }
            );

            spotifyApi.setAccessToken(accessToken);
            let trackNames = [];
            let playlistInfo;

            if (isSpotifyTrack) {
              const trackId = query.split('track/')[1].split('?')[0];
              const trackInfo = await spotifyApi.getTrack(trackId);
              trackNames.push(`${trackInfo.body.name} ${trackInfo.body.artists[0].name}`);
            } else if (isSpotifyPlaylist) {
              const playlistId = query.split('playlist/')[1].split('?')[0];
              playlistInfo = await spotifyApi.getPlaylistTracks(playlistId);
              trackNames = playlistInfo.body.items
                .filter(item => item && item.track)
                .map(item => `${item.track.name} ${item.track.artists[0]?.name || ''}`);
            } else if (isSpotifyAlbum) {
              const albumId = query.split('album/')[1].split('?')[0];
              const albumInfo = await spotifyApi.getAlbumTracks(albumId);
              trackNames = albumInfo.body.items
                .map(track => `${track.name} ${track.artists[0]?.name || ''}`);
            } else if (isSpotifyArtist) {
              const artistId = query.split('artist/')[1].split('?')[0];
              const artistTopTracks = await spotifyApi.getArtistTopTracks(artistId, 'US');
              trackNames = artistTopTracks.body.tracks
                .map(track => `${track.name} ${track.artists[0]?.name || ''}`);
            } else if (isSpotifyCollection) {
              return; // Handle Spotify collection if needed
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
                if (error.errorCode === 'NON_NSFW') {
                  await interaction.followUp({
                    embeds: [
                      new EmbedBuilder()
                        .setColor('#FF0000')
                        .setDescription(`🚫 Đã bỏ qua nội dung bị giới hạn độ tuổi: **${trackName}**. Bài hát này không thể phát trong các kênh không NSFW.`),
                    ],
                  });
                  continue;
                } else {
                  throw error;
                }
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
                embeds: [
                  new EmbedBuilder()
                    .setColor('#FF00FF')
                    .setDescription(`🎶 Đã thêm **${queuedTracks.length}** bài từ Spotify.`),
                ],
              });
            } else {
              await interaction.followUp({
                embeds: [
                  new EmbedBuilder()
                    .setColor('#FFFF00')
                    .setDescription('🚫 Không tìm thấy bài hát hợp lệ từ Spotify.'),
                ],
              });
            }

          } catch (error) {
            let errorMessage = '🚫 Đã xảy ra lỗi khi cố gắng phát từ Spotify.';
            if (error.message === 'SpotifyAccessError') {
              errorMessage = '🚫 Không thể lấy token truy cập Spotify.';
            }

            await interaction.followUp({
              embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription(errorMessage)],
            });
          }
        } else {
          await interaction.followUp({
            embeds: [new EmbedBuilder().setColor('#FFFF00').setDescription('🚫 URL Spotify không hợp lệ.')],
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
