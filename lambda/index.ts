import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import fetch from 'node-fetch'
import { createSetlist, spGetPlaylist, spModSearchSong, spReCreatePlaylist, spSearchArtist } from './spotify'
import * as AWS from 'aws-sdk'


const app = new Hono()

const lambda = new AWS.Lambda()

// CORSミドルウェアを追加
app.use('*', cors())

app.use('*', logger())


interface Song {
    name: string;
    original_artist: string;
    is_tape?: boolean;
    is_cover: boolean;
    position?: number;
}

interface Setlist {
    artist_name: string;
    event_date?: Date;
    location: string;
    venue: string;
    tour_name: string;
    songs: Song[];
    setlist_id?: string;
}

app.get('/', (c) => c.text('hello'))

app.get('/api', (c) => c.text('hello!!'))

app.get('/api/livefans/:id', async (c) => {  // LiveFansからセットリストを取得
    const id = c.req.param('id')

    const iscover: boolean = c.req.query('isCover') === 'true'

    const url = `https://www.livefans.jp/events/${id}`

    if (!url) {
        return c.json({ error: 'URL parameter is required' }, 400)
    }


    try {
        const params = {
            FunctionName: 'arn:aws:lambda:ap-northeast-1:403617712053:function:selenium-lambda', // 呼び出したいLambda関数の名前
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({ 'handler_type': 'main', url, iscover })
        }

        const result = await lambda.invoke(params).promise()
        const setlistJson = JSON.parse(result.Payload as string)


        const setlist: Setlist = {
            artist_name: setlistJson?.artist_name,
            // event_date: new Date(setlistJson?.event_date),
            location: setlistJson?.location,
            venue: setlistJson?.venue,
            tour_name: setlistJson?.tour_name,
            songs: setlistJson?.songs,
        }

        console.log(setlist.songs)

        const setlist_id = await createSetlist(setlist);

        setlist.setlist_id = setlist_id;

        return c.json(setlist);

    } catch (error) {
        console.error('Error invoking Lambda:', error)
        return c.json({ error: 'Failed to invoke Lambda function' }, 500)
    }

})

app.get('/api/setlistfm/:id', async (c) => {  // Setlist.fmからセットリストを取得
    const id = c.req.param('id')
    // const iscover = c.req.query('isCover')
    // const istape = c.req.query('isTape')

    const iscover: boolean = c.req.query('isCover') === 'true'  // 上のやり方だとstringで代入されるので上手くいかなかった(型を付けることの大切さ)
    const istape: boolean = c.req.query('isTape') === 'true'


    const url: string = `https://api.setlist.fm/rest/1.0/setlist/${id}`
    const headers = {
        "x-api-key": "rvH9s-nOQE4FOGgLByWj1VfmjzqIaEt5Q8wB",
        "Accept": "application/json",
        // "Access-Control-Allow-Origin": "*"
    }

    try {
        console.log(`Fetching setlist with ID: ${id}`);
        const response = await fetch(url, { headers })

        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status}`);  // エラーログ
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data: any = await response.json();
        console.log('Fetched data:', data);  // デバッグ用ログ


        const artistName = data.artist.name;
        const eventDate = new Date(data.eventDate.split('-').reverse().join('-'));
        const venueData = data.venue;
        const cityData = venueData.city;
        const country = cityData.country.name;
        const city = `${cityData.name}, ${country}`;
        const venue = venueData.name;
        const tourName = data.tour?.name || "";

        const setlistSongs: Song[] = [];

        data.sets.set.forEach((setData: any) => {
            setData.song.forEach((songData: any) => {

                const songName = songData.name;
                const isTape = songData.tape || false;
                const isCover = 'cover' in songData;
                const medleyParts = songName.split(" / ");

                for (const medleyPart of medleyParts) {
                    const originalArtist = isCover ? songData.cover.name : artistName;
                    const song: Song = {
                        name: medleyPart,
                        original_artist: originalArtist,
                        is_tape: isTape,
                        is_cover: isCover,
                    };


                    if (song.is_tape) {
                        continue;
                    }

                    if (!iscover || !song.is_cover) {
                        setlistSongs.push(song);
                    }

                };
            });
        });



        const setlist: Setlist = {
            artist_name: artistName,
            event_date: eventDate,
            location: city,
            venue: venue,
            tour_name: tourName,
            songs: setlistSongs,
            setlist_id: id,
        };

        console.log('Constructed setlist:', setlist);  // デバッグ用ログ


        const setlist_id = await createSetlist(setlist);

        setlist['setlist_id'] = setlist_id;

        return c.json(setlist);

    } catch (error) {
        console.error('Error fetching setlist:', error)
        return c.json({ error: 'Failed to fetch setlist' }, 500)
    }
})

app.get('/api/modify/:id', async (c) => {
    const id = c.req.param('id')

    const response: any = await spGetPlaylist(id);
    return c.json(response);
});

// 曲名とアーティスト名からSpotifyを検索
app.get('/api/song/search/:artist/:name', async (c) => {
    const name: string = c.req.param('name') || ''
    const artist: string = c.req.param('artist') || ''

    const data = await spModSearchSong(name, artist);

    return c.json(data);
})

// アーティスト名からSpotifyを検索
app.get('/api/artist/search', async (c) => {
    const query: string = c.req.query('q') || '';
    const site: string = c.req.query('site') || '';
    console.log(site);

    const data: any = await spSearchArtist(query, site);


    return c.json(data);
})


app.post('/api/recreate/playlist/:id', async (c) => {
    const id: string = c.req.param('id')
    const songIds: string[] = JSON.parse(await c.req.text());
    console.log(songIds);

    const playlistId = await spReCreatePlaylist(id, songIds) as any;

    return c.json(playlistId);
})

app.get('/fetch-html/setlistfm', async (c) => {
    try {
        const artist = c.req.query('artist') || ''
        const encodedArtist = encodeURIComponent(artist).replace(/%20/g, '+')

        const headers = {
            "x-api-key": "rvH9s-nOQE4FOGgLByWj1VfmjzqIaEt5Q8wB",
            "Accept": "application/json",
        }
        const url = `https://api.setlist.fm/rest/1.0/search/artists?artistName=${encodedArtist}&sort=relevance`

        const response = await fetch(url, { headers })
        const data: any = await response.json();

        const mbid: string = data.artist[0].mbid

        const searchSetlist = await fetch(`https://api.setlist.fm/rest/1.0/artist/${mbid}/setlists`, { headers })

        const setlistData: any = await searchSetlist.json();

        console.log(setlistData)

        return c.json(setlistData)


    } catch (error) {
        console.error('Error fetching HTML:', error)
        return c.text('Error fetching HTML', 500)
    }
})

app.get('/fetch-html/livefans', async (c) => {
    try {
        const artist = c.req.query('artist') || ''
        const encodedArtist = encodeURIComponent(artist).replace(/%20/g, '+')
        const url = `https://www.livefans.jp/search?option=1&keyword=${encodedArtist}&genre=all`

        const response = await fetch(url)

        // const html: any = await response.text()

        const params = {
            FunctionName: 'arn:aws:lambda:ap-northeast-1:403617712053:function:selenium-lambda',
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({ 'handler_type': 'sub', url })
        }

        const result = await lambda.invoke(params).promise()
        const setlistJson = JSON.parse(result.Payload as string)

        console.log(setlistJson)

        return c.json(setlistJson)
    } catch (error) {
        console.error('Error fetching HTML:', error)
        return c.text('Error fetching HTML', 500)
    }
})


export default app;


export const handler = handle(app)








