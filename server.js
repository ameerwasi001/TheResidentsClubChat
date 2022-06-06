const env = {
  client: 'http://localhost:8000'
}

const app = require('express')();
const server = require('http').Server(app);
const cors = require("cors");
const bodyParser = require('body-parser')
const redis = require("redis");
const knex = require('knex')({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: '',
    database: 'the_residents_club',
  },
  pool: { min: 0, max: 100 },
})


const setSocketData = (client, socket, obj) => client.set(`${socket.id}`, JSON.stringify(obj))
const getSocketData = async (client, socket) => JSON.parse(await client.get(`${socket.id}`))

const io = require("socket.io")(server, {
    cors: {
      origin: env.client,
      credentials: true
    }
  }
)

const client = redis.createClient();

app.options("*", cors({ origin: env.client, optionsSuccessStatus: 200 }))
app.use(cors({ origin: env.client, optionsSuccessStatus: 200 }))
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

client.connect().then(async _ => {
  await client.flushDb()
  server.listen(3000)

  io.sockets.on('connect', async socket => {
    console.log(`connected to ${socket.id}`)
    const userId = parseInt(JSON.parse(socket.handshake.query.user).id)
    const {name, socketToken} = JSON.parse(socket.handshake.query.user)

    const [{socket_token: userSocketToken}] = await knex.table('users')
      .where({'id': userId})
      .select('socket_token')
    console.log(userSocketToken, socketToken)

    if(socketToken !== userSocketToken) return socket.disconnect()

    await setSocketData(client, socket, {id: userId, name})

    let err = false
  
    const rowsPerPage = 50
    socket.on('messages', async page => {
      console.log('sklmskmsksmk')
      const messages = await knex.table('club_house_messages')
        .offset((page-1)*rowsPerPage)
        .limit(rowsPerPage)
        .orderBy('club_house_messages.created_at', 'DESC')
        .join('club_house_aliases', {'club_house_messages.alias_id': 'club_house_aliases.id'})
        .select('club_house_aliases.alias', 'club_house_messages.text')


      const [{'count(*)': count}] = await knex.table('club_house_messages').count()
      const hasMore = count > page*rowsPerPage
      socket.emit('queried-messages', {messages, hasMore})
    })

    socket.on('new-message', async ({user_id, alias, text}) => {
      const user = await getSocketData(client, socket)
      await knex.transaction(async trx => {
        const alias_users = await trx('club_house_aliases')
          .where({'alias': alias})
          .select('user_id')
          .distinct()

        if(alias_users.length >= 1 && alias_users[0].user_id != user.id) {
          err = true
          return socket.emit('non-unique-alias', {msg: `The alias ${alias} is already taken`})
        }

        await trx('club_house_aliases')
          .insert({alias: alias, user_id: user.id, created_at: knex.fn.now(), updated_at: null})
          .onConflict('alias')
          .merge()

        const db_alias = await trx('club_house_aliases')
          .where({alias: alias})
          .select('id')
          .first();

        const message = await trx('club_house_messages')
          .insert({'alias_id': db_alias.id, text, 'created_at': knex.fn.now(), updated_at: null})
          
        return message
      })
      if(!err) io.sockets.emit("message", {text, user_id, alias})
    })

    socket.on('disconnect', async function () {
      console.log(`disconnected from ${socket.id}!`);
      console.log(await client.get(`${socket.id}`))
      client.del(`${socket.id}`)
   })
  })
})

