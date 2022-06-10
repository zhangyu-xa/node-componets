/*
* @Author: zhangyu
* @Date:   2021-12-25 20:46:39
* @Last Modified by:   zhangyu
* @Last Modified time: 2021-12-28 15:33:28
* @Email: zhangyu6936@fiberhome.com
*/
const child_process = require('child_process');
const dotenv = require('dotenv');
const path = require('path');
const { stdout, getTimeSlot, createLocalFile, getHelpInfo } = require('./utils.js');
const SSH2Tools = require('./deploy.js');
const config = require("./config.json");

dotenv.config();

let ssh2Tool = null;
/**
 * 发布启动逻辑
 */
function dealPublish ({localPath,  remotePath, server}) {
	stdout(`部署目标服务器IP：${server.host}\n待部署的本地目录：${path.join(__dirname, localPath).replace(/\\/gi, '/')}\n部署到服务器目录：${remotePath}\n启动发布流程...\n\n`, true);
	ssh2Tool.startPublish(err => {
		if(err){
		 	stdout(`\n\n发布失败！！!\n ${err}`, true) 
		} else {
			// 更新发布日志
			updateDeployLog(remotePath);
			// 清理备份文件
			cleanBackupDirs(remotePath);
			// 退出进程
			setTimeout(() => {
				stdout("\n\n发布完成！！！", true);
				process.exit();
			}, 2000);
		}
	});
};

function cleanBackupDirs(remotePath) {
	// 获取参数 
	const reservedNum = 3;// 3，保留备份的目录个数，后续可以扩展npm cooked参数，TODO
	const shellFileName = "clean.sh";
	// 上传sh到服务器
	const shRPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
	const shLPath = path.join(__dirname, "../", "deploy");

	// 组装参数
	const shParams = {
		prefix: remotePath.split("/").pop(),
		reservedNum
	}
	ssh2Tool.execSH(shLPath, shRPath, shellFileName, shParams, err => {stdout("")});
}

function updateDeployLog(remotePath) {
	const deployLogPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
	try {
		ssh2Tool.exec(`cat ${remotePath}/deploy.log ${deployLogPath}/deploy.log >> ${deployLogPath}/temp.log \n mv ${deployLogPath}/temp.log -f ${deployLogPath}/deploy.log  \n exit \n`, (msg1, msg2) => {});
	} catch (err) {
		// 静默处理异常
	}
}

function checkWorkSpace(isForceMode) {
	return new Promise((resolve, reject) => {
		isForceMode ? resolve() : child_process.exec("git status -s", { 'encoding': 'utf-8' }, (error, stdout, stderr) => {
            if(error || stderr) reject(error || stderr);
            if(stdout) reject("error: 当前工作区仍有未提交或者未纳入版本控制的文件，请确保工作干净后再开始部署");
            resolve();
        });
	});
}

function getGitInfos() {
	const cmd = `git name-rev --name-only HEAD && 
				 git rev-parse HEAD && 
				 git config --get user.name && 
				 git config --get user.email
				`;
	try {
		return child_process.execSync(cmd.replace(/\n/gm,""), { 'encoding': 'utf-8' }).split("\n");
	} catch (e) { 
		// 静默处理异常
		stdout("warn: can't get git information.", true);
		return [];
	}
}

function getDeployConf(sysName) {
	const version = process.env.npm_package_version;
	return new Promise((resolve, reject) => {
		// 检测项目配置
		const sysConf = typeof config === 'object' ? config[sysName] : null;
		if(!sysConf || Object.prototype.toString.call(sysConf) !== "[object Object]") reject(`未检测到项目 ${sysName} 部署配置信息，请添加并确认`);
		
		//如果没有传递部署服务器的ip，则默认部署在第一个配置
		let serverIp = process.env.deploy_IP || Object.keys(sysConf)[0];
		if(!serverIp || !sysConf[serverIp]) reject(serverIp ? `1.未检测到项目 ${sysName} 关于远程目标服务器 ${serverIp} 的部署配置信息\n2.请确认.env文件的deploy_IP节点配置是否正确` : 
			`未检测到项目 ${sysName} 部署配置信息，请添加并确认`);
		resolve(Object.assign(sysConf[serverIp], {sysName, version}));
	});
}

function injectDeployInfo(sysName, {localPath}) {
	// 获取本地git参数
	const gitInfos = getGitInfos();
	if(gitInfos.length > 0) {
		const [branchName, commitID, user, email] = gitInfos;
		const msg = `发布人：${user}（${email}）\n分支名称：${branchName}\n最后一次提交的 commitID: ${commitID}\n\n`;
		stdout(msg, true);
		// 注入版本信息
		createLocalFile(localPath, `时间：${getTimeSlot()}\n发布工程：${sysName}\n${msg}`, "deploy.log");
	}
}

function startPublish({sysName, version, ...sysConf}, isForceMode) {
	//判断工作区是否干净
	checkWorkSpace(isForceMode).then(() => {
		stdout(`部署的工程名：${sysName} (version：${version})\n`, true);
		// 准备变更信息
		injectDeployInfo(sysName, sysConf);
		// 开始发布动作
		dealPublish(sysConf);
	}, err => {
		stdout(err, true);
	});
}

function startRevert({sysName, localPath,  remotePath, server}) {
	// 获取参数 
	const vFlag = 1;// 1，标识回退到上一个版本，后续可以扩展npm cooked参数，TODO
	const shellFileName = "revert.sh";
	// 上传sh到服务器
	const shRPath = remotePath.substring(0, remotePath.lastIndexOf("/"));
	const shLPath = path.join(__dirname, "../", "deploy");

	// 组装参数
	const shParams = {
		prefix: remotePath.split("/").pop(),
		vFlag
	}

	stdout(`正在将工程 ${sysName} 回退到上一个版本...`);
	ssh2Tool.startRevert(shLPath, shRPath, shellFileName, shParams, err => {
		if(err){
		 	stdout(`\n\n回退失败！！！\n ${err}`, true) 
		} else {
			stdout("\n\n回退成功！！！", true);
			// 更新发布日志
			const gitInfos = getGitInfos();
			if(gitInfos.length > 0) {
				const [,,user, email] = gitInfos;
				const log = `时间：${getTimeSlot()}\\n回退工程：${sysName}\\n执行人：${user}（${email}）\\n\\n`;
				ssh2Tool.exec(`cd ${shRPath}\n sed -i "1i${log}" deploy.log \n exit \n`, (err, data) => {});
			}
		}
	});
}

function showDeployLog() {
	// body...
}

/**
 * 校验命令是否合法
 * @param  {[boolean]} isLegal 是否合法
 * @return {[boolean]}         校验是否通过
 */
function checkNpmCmd(isLegal) {
	const npmCooked = JSON.parse(process.env.npm_config_argv)["cooked"];
	return !(npmCooked.length > 3 || 
		(npmCooked.length === 3 && !isLegal) || 
		(npmCooked.length === 3 && isLegal && npmCooked[2].indexOf("--") < 0));
}

(function () {
	const isRevertScene = process.env.npm_config_revert || false;
	const isLogScene = process.env.npm_config_log || false;
	const isForceMode = process.env.npm_config_force || false;
	
	/*console.log(JSON.parse(process.env.npm_config_argv)["cooked"]);
	console.log(process.env);
	return*/;
	// 检查命令参数是否合法
	if(!checkNpmCmd(isRevertScene || isLogScene || isForceMode)) {
		stdout(getHelpInfo(), true);
		return;
	}

	// 获取工程名称
	const sysName = `fitmgr-${process.env.npm_package_name}`;

	// 获取部署配置信息
	getDeployConf(sysName).then(sysConf => {
		if(ssh2Tool) ssh2Tool.disConnect();
		//创建ssh2Tool实例
		ssh2Tool = new SSH2Tools(sysConf);

		// 触发回滚，目前只支持回滚到上一次
		if(isRevertScene) {
			startRevert(sysConf);
			return;
		}

		// 显示更新日志
		if(isLogScene) {
			showDeployLog(sysConf);
			return;
		}
		
		// 触发远程发布
		startPublish(sysConf, isForceMode);
	}, err => {
		stdout(err, true);
	});
})();