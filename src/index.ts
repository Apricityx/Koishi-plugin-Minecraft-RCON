// noinspection TypeScriptValidateJSTypes

import {Context, Schema} from 'koishi'
import {spawn} from 'child_process'

export const name = 'minecraft-rcon-command'

export interface Config {

}

export const Config: Schema<Config> = Schema.object({
  servers: Schema.array(Schema.object({
    name: Schema.string().description('服务器名称').default('114514'),
    address: Schema.string().description('服务器地址').default('127.0.0.1'),
    password: Schema.string().description('RCON密码').default('password'),
    port: Schema.number().description('RCON端口').default(25576),
  })).role('table').default([{address: '127.0.0.1', password: 'password', port: 25576, name: '114514'}]),
  debug: Schema.boolean().description('是否启动调试模式').default(false).required(),
  timeout: Schema.number().description('超时时间(s)').default(10),
})

export function apply(ctx: Context, config: Config) {
  //https://gitee.com/apricityx/Minecraft-RCON.git
  const ifDebug = config['debug']
  const logger = ctx.logger('Debug')
  const timeout = config['timeout']
  function debug(text: any) {
    if (ifDebug)
      logger.success(text)
  }

  //执行py脚本中的hello函数

  const servers = config['servers']
  debug('从配置文件中获取：' + servers.length + '个服务器')

  async function run(command: string, args: string, server: any, server_name: string) {
    let temp = ''
    let data = server + ',' + command + ',' + args
    debug('正在当前目录寻找python脚本：' + ctx.baseDir + '/node_modules/koishi-plugin-minecraft-rcon-command/src/Minecraft-Rcon/main.py')
    const python = spawn('python', [ctx.baseDir+ '/node_modules/koishi-plugin-minecraft-rcon-command/src/Minecraft-Rcon/main.py', data])
    // 捕获控制台输出对象stdout
    python.stdout.on('data', function (data) {
      temp = data.toString()
    })
    // 捕获控制台输出对象stderr
    python.stderr.on('data', function (data) {
      debug('python出错: ' + data.toString())
    })
    let n = config['timeout']
    while (temp == '' && n != 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      n--
      if (n == 0) {
        debug(server_name + '服务器未响应，请检查服务器是否开启')
        temp = '服务器炸了'
      }
    }
    return server_name + ': ' + temp
  }

  let server = servers[0]

  ctx.command('whitelist <method> <player>')
    .action(async ({session}, method, player) => {
      for (server in servers) {
        server = servers[server]
        let address = server['address']
        let port = server['port']
        let password = server['password']
        let name = server['name']
        let origin = address + ',' + port + ',' + password
        debug('已连接至服务器' + origin)
        debug('尝试将玩家 ' + player + ' 加入' + '服务器：' + origin + '白名单')

        // 调用py脚本
        // 实现py脚本打印值后，再将值赋值给resp，再将resp返回给用户
        // 避免resp的值为空
        if (method != 'add' && method != 'remove') {
          await session.send('请输入正确的指令')
          return
        }
        if (player == null) {
          await session.send('请输入玩家名')
          return
        }
        if (method == 'add') {
          let resp = await run('whitelist', player, origin, name)
          debug(resp)
          session.send(resp).then(() => {
            debug('已尝试将玩家 ' + player + ' 加入白名单')
          })
        }
        if (method == 'remove') {
          let resp = await run('whitelist_remove', player, origin, name)
          debug(resp)
          session.send(resp).then(() => {
            debug('已尝试将玩家 ' + player + ' 移出白名单')
          })
        }
      }
    })

  ctx.command('!!online')
    .action(async ({session}) => {
      debug('尝试查看在线人数')
      for (server in servers) {
        server = servers[server]
        let address = server['address']
        let port = server['port']
        let password = server['password']
        let name = server['name']
        let origin = address + ',' + port + ',' + password
        let resp = await run('list', '', origin, name)
        session.send(resp).then(() => {
          debug('已查看在线人数')
        })
      }
    })
}


