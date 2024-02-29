// noinspection TypeScriptValidateJSTypes

import {spawn} from 'child_process'
import {Context, Schema} from 'koishi'

export const name = 'minecraft-rcon-command'

export interface Config {
}

export const usage = 'Minecraft RCON指令插件'
export const Config: Schema<Config> = Schema.object({
    servers: Schema.array(Schema.object({
        name: Schema.string().description('服务器名称').default('114514'),
        address: Schema.string().description('服务器地址').default('127.0.0.1'),
        password: Schema.string().description('RCON密码').default('password'),
        port: Schema.number().description('RCON端口').default(25575),
    })).role('table').default([{address: '127.0.0.1', password: 'password', port: 25575, name: '114514'}]),
    connection_timeout: Schema.number().description('与RCON连接超时时间(s)').default(60),
    select_timeout: Schema.number().description('选择服务器超时时间(s)').default(100),
    vote_num: Schema.number().description('多少人投同意票视为投票通过').default(3),
    vote_timeout: Schema.number().description('投票超时时间(s)').default(60),
    if_add_all_whitelist: Schema.boolean().default(false).description('是否添加该人到所有服务器的白名单'),
    path: Schema.string().description('python脚本路径(一般不需要动)').default('/node_modules/koishi-plugin-minecraft-rcon-command/lib/Minecraft-Rcon/main.py'),
    debug: Schema.boolean().default(false),
})
var __voting = false
var __selecting = false
var __session_now
var stop_flag = false
var veto = false
var __vote_person_userid = []
var __last_execute_element_id = ''

export function apply(ctx: Context, config: Config) {
    function simple_reply(session: any, text: string) {
        session.send(<>
            <quote id={(session.messageId).toString()}/>
            <at id={session.userId}/>
            {'\n' + text}
        </>)
    }

    ctx.middleware((session, next) => {
        __session_now = session
    })
    const if_add_all_whitelist = config['if_add_all_whitelist']
    const ifDebug = config['debug']
    const servers = config['servers']
    const path = config['path']
    const logger = ctx.logger('minecraft-rcon-command')
    const connection_timeout = config['connection_timeout']
    const wait_timeout = config['select_timeout']
    const vote_num = config['vote_num']
    const vote_timeout = config['vote_timeout']

    function debug(text: any) {
        if (ifDebug)
            logger.success(text)
    }

    debug("启动完成！")
    debug('从配置文件中获取：' + servers.length + '个服务器')
    debug('服务器为:' + servers.map((server: any) => server.name).join(','))

    async function send_command(command: string, server: any) {
        debug("服务器的信息为：" + JSON.stringify(server))
        if (!command.startsWith('/')) {
            command = '/' + command
        }
        debug('尝试发送指令' + command + '到服务器：' + server.name)
        let py_path = ctx.baseDir + path
        debug('python脚本路径为：' + py_path)
        let data = server.address + ',' + server.port + ',' + server.password + ',' + command
        let output = ''
        const python = spawn('python', [path, data]) // data需要满足的值为：server,port,password,command,arg
        python.stdout.on('data', function (data) {
            debug('python输出: ' + data.toString())
            output = data.toString()
        })
        // 捕获控制台输出对象stderr
        python.stderr.on('data', function (data) {
            debug('python出错: ' + data.toString())
            output = data.toString()
        })
        // 注册子进程关闭事件
        python.on('exit', function (code, signal) {
            debug('python子进程关闭, 退出码: ' + code)
        })
        let counter = connection_timeout
        while (output === '' && counter > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            counter -= 1
            if (counter === 0) {
                debug(server.name + ' 连接超时')
                return '连接超时'
            }
        }
        return output
    }

    async function select_server(servers: any, {session}) {
        if (__selecting) {
            session.send('正在选择服务器，请稍后')
            return -1
        }
        __selecting = true
        let server_list = servers.map((server: any) => server.name)
        let counter = wait_timeout
        let server_num = -1
        let message_now = ''
        while (server_num === -1 && counter > 0) {
            // debug('当前信息：' + JSON.stringify(__session_now))
            await new Promise(resolve => setTimeout(resolve, 1000))
            if (stop_flag) {
                __selecting = false
                stop_flag = false
                session.send('选择已取消')
                return -1
            }
            if (__session_now === undefined) {
                continue
            } else {
                if (!(__session_now.messageId === __last_execute_element_id)) {
                    message_now = __session_now.content
                }
            }

            counter -= 1
            if (counter === 0) {
                session.send('选择超时')
                __selecting = false
                return -1
            }
            let server_list_num: string[] = []
            for (let i = 0; i < server_list.length; i++) {
                server_list_num.push(i.toString())
            }

            if (message_now in server_list_num) {
                __selecting = false
                __last_execute_element_id = __session_now.messageId
                return parseInt(message_now)
            }
        }
    } // 返回选择的服务器的编号，如果取消返回-1提示主程序终止

    var __vote_result = -1
    var __vote_progress = ''
    ctx.command('!!vote <arg:text>').action(async ({session}, arg) => { //需要注意的是，投票成功后的vite_result需要重置为-1
        debug('收到投票！投票人：' + session.userId + ' 投票内容：' + arg)
        if (__voting) {
            __vote_result = -1
            if (__vote_person_userid.includes(session.userId)) {
                session.send(<>
                    <quote id={(session.messageId).toString()}/>
                    <at id={session.userId}/>
                    {' 你已经投过票了'}</>)
            } else if (arg === 'yes') {
                //将进度条中的一个◇变为◆
                __vote_progress = __vote_progress.replace('◇', '◆')
                if (__vote_progress.includes('◇')) {
                    session.send(<>
                        <quote id={(session.messageId).toString()}/>
                        <at id={session.userId}/>
                        {' 投票成功\n' + '当前投票进度：' + __vote_progress}</>)
                } else {
                    debug('投票完成，将不返回进度条')
                }
                __vote_result = 1 //1代表同意
            } else if (arg === 'no') {
                session.send(<>
                    <quote id={(session.messageId).toString()}/>
                    {'投票被'}
                    <at id={session.userId}/>
                    {'一票否决\n' + '最终投票进度：' + __vote_progress}</>)
                __vote_progress = ''
                __vote_result = 0 //0代表不同意
            } else {
                session.send(<>
                    <quote id={(session.id).toString()}/>
                    {' 请输入!!vote yes/no进行投票'}</>)
            }
        } else {
            session.send('当前无人发起指令投票\n请使用!!run [指令] 发起投票')
        }
        return
    })

    async function vote({session}) {
        if (__voting) {
            session.send(<>
                <quote id={(session.messageId).toString()}/>
                {'当前正在进行投票，请稍后'}</>)
            return
        }
        __voting = true
        __vote_progress = ''
        for (let i = 0; i < config['vote_num']; i++) {
            __vote_progress = __vote_progress + '◇ '
        }
        debug('开始投票,进度条:' + __vote_progress)
        let vote_num = 1
        __vote_progress = __vote_progress.replace('◇', '◆')
        __vote_person_userid.push(session.userId)
        session.send(<>
            <quote id={(session.messageId).toString()}/>
            {'投票已发起\n' + '当前投票进度：' + __vote_progress}</>)
        while (vote_timeout > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000))
            if (__vote_result === 1) {
                vote_num += 1
                __vote_result = -1 //-1代表未选择
                __vote_person_userid.push(session.userId)
                debug('投票成功，当前进度：' + __vote_progress + '\n当前投票人：' + __vote_person_userid)
            } else if (__vote_result === 0) {
                __vote_result = -1 //-1代表未选择
                __vote_person_userid = []
                __voting = false
                return false
            }
            if (vote_num >= config['vote_num']) {
                __vote_result = -1
                __vote_person_userid = []
                __voting = false
                return true
            }
        }
    }

    ctx.command('!!stop').action(({session}) => {
        if (__selecting) {
            stop_flag = true
            debug('满足条件，停止选择')
            return
        } else {
            simple_reply(session, '当前没有选择任务')
            debug('不满足停止选择条件')
        }
    })
    ctx.command('!!test').action(async ({session}) => {
        let data = ''
        for (let temp in config) {
            if (temp === 'servers') {
                data = data + 'servers: ' + JSON.stringify(servers) + '\n'
            } else {
                data = data + temp + ': ' + config[temp] + '\n'
            }
        }
        // await session.send('当前配置项如下：\n' + data + '\n')
        // await session.send(await send_command('/list', '', servers[0]))
        // let server_num = await select_server(servers, {session})
        // if (server_num === -1) return
        // session.send(<>
        //     <at id={session.userId}/>
        //     {'选择了服务器：' + servers[server_num].name + ' 请稍后...'}
        // </>)
        // debug('选择服务器完成' + '选择的服务器为：' + servers[server_num].name)
        //
        let result = await vote({session})
        debug('投票结果：' + result)
    })
    ctx.command('!!run <arg:text>').action(async ({session}, arg) => {
        if (!(arg.startsWith('/'))) {
            debug('指令不以/开头，自动添加/前缀')
            arg = '/' + arg
        }
        debug('收到指令：' + arg + ' 开始选择服务器')
        let server_list = servers.map((server: any) => server.name)
        let data = server_list.map((server: any, index: number) => '[' + index + '] ' + server).join('\n')
        session.send(<>
            <quote id={(session.messageId).toString()}/>
            <at id={session.userId}/>
            {'\n请选择需要执行命令的服务器：\n'}{data}</>)
        let server_num = await select_server(servers, {session})
        if (server_num === -1) return
        let server = servers[server_num]
        let if_run = await vote({session})
        if (!if_run) {
            return
        }
        session.send(<>
            <at id={session.userId}/>
            {'\n投票通过！\n投票结果：' + __vote_progress + '\n已向服务器：' + server.name + ' 发送指令' + arg + '，请稍后...'}
        </>)
        debug('选择服务器完成' + '选择的服务器为：' + server.name)
        let result = await send_command(arg, server)
        if (result === '连接超时') {
            session.send('服务器' + server.name + '连接超时')
            return
        }
        session.send('指令：' + arg + ' 执行成功\n服务器返回：' + result)
    })
    ctx.command('!!whitelist <arg:text>').action(async ({session}, arg) => {
        let args = []
        let data = []
        try {
            args = arg.split(' ')
            if (args.length !== 2) {
                simple_reply(session, '参数错误')
                return
            }
            if (args[0] == 'add') {
                let result = await send_command('/whitelist add ' + args[1], servers[0])
                if (result === '连接超时') {
                    session.send('服务器' + servers[0].name + '连接超时')
                    return
                }
                if (if_add_all_whitelist) {
                    data.push('\n尝试将玩家' + args[1] + '添加至服务器白名单，执行结果如下：\n')
                    simple_reply(session, '执行中，请稍后...')
                    for (let i = 0; i < servers.length; i++) {
                        debug('尝试将玩家' + args[1] + '添加至服务器白名单，执行结果如下：\n' + data.join(''))
                        let result = await send_command('/whitelist add ' + args[1], servers[i])
                        if (result === '连接超时') {
                            data.push('服务器' + servers[i].name + '连接超时\n')
                            return
                        }
                        if (result.startsWith('Player is already whitelisted')) {
                            data.push('服务器' + servers[i].name + '已经存在该玩家，跳过添加\n')
                        } else if (result.startsWith('Added')) {
                            data.push('服务器' + servers[i].name + '添加成功\n')
                        } else {
                            data.push('服务器' + servers[i].name + '添加失败，服务器未响应\n')
                        }
                    }
                } else {
                    let server_list = servers.map((server: any) => server.name)
                    let server_list1 = server_list.map((server: any, index: number) => '[' + index + '] ' + server).join('\n')
                    session.send(<>
                        <quote id={(session.messageId).toString()}/>
                        <at id={session.userId}/>
                        {'\n请选择需要执行命令的服务器：\n'}{server_list1}</>)
                    let server_num = await select_server(servers, {session})
                    if (server_num === -1) return
                    let server = servers[server_num]
                    result = await send_command('/whitelist add ' + args[1], server)
                    data.push('\n尝试将玩家' + args[1] + '添加至服务器白名单，执行结果如下：\n')
                    if (result === '连接超时') {
                        session.send('服务器' + server.name + '连接超时')
                        return
                    }
                    if (result.startsWith('Player is already whitelisted')) {
                        data.push('服务器' + server.name + '已经存在该玩家，跳过添加\n')
                    } else if (result.startsWith('Added')) {
                        data.push('服务器' + server.name + '添加成功\n')
                    } else {
                        data.push('服务器' + server.name + '添加失败，服务器未响应\n')
                    }
                }
                simple_reply(session, data.join(''))
            }
        } catch (e) {
            simple_reply(session, '参数错误')
            return
        }
    })
    ctx.command('!!online').action(async ({session}) => {
        let data = []
        for (let i = 0; i < servers.length; i++) {
            let result = await send_command('/list', servers[i])
            if (result === '连接超时') {
                session.send('服务器' + servers[i].name + '连接超时')
                return
            }
            if (result.startsWith('There are')) {
                //在线人数在are和of之间
                let online_num = result.split('are')[1].split('of')[0]
                if (online_num === ' 0 ') {
                    data.push('服务器' + servers[i].name + '无人在线\n')
                } else {
                    let person = result.split('online')
                    data.push('服务器' + servers[i].name + '在线玩家：' + person + '\n')
                }
            } else {
                data.push('服务器' + servers[i].name + '连接失败\n')
            }
        }
        simple_reply(session, data.join(''))
    })
}
