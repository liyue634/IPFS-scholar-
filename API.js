const express = require('express');
var bodyParser = require('body-parser');
var bcrypt = require('bcryptjs');
var { SECRET, EXPIRESD } = require('./core/store')
const jwt = require('jsonwebtoken');
const app = express();
const path = require('path');
const { createPow } = require('@textile/powergate-client')
const host = "http://45.32.19.182:6002"
const pow = createPow({ host })
const { ffsTypes } = require('@textile/powergate-client')
const func = require('./function.js')
const fs = require('fs');
const formidable = require('formidable');
const User = require('./core/user');
const File = require('./core/file');
//global.currentuser = new User();
const exec = func.connectDb();

app.use(bodyParser.json({ limit: "1mb" }));
app.use(
    bodyParser.urlencoded({
        extended: true,
    })
);

app.listen(3000, () => {
    console.log("3000 listening");
});



app.post('/register', (req, res, next) => {
    const username = req.body.username;
    const password = bcrypt.hashSync(req.body.password);
    const email = req.body.email;
    console.log("-------------------------register-----------------------------")
    console.log("(register)username:" + username + ",password:" + password + ",email:" + email);
    // var exec = func.connectDb();

    try {
        let sql = `select * from user_logininfo where username='${username}'`;
        exec(sql).then(async (result) => {
            if (result && result.length != 0) {
                res.json({
                    "code": 422,
                    "msg": "The user has been registered!"
                })
                return;
            } else {
                try {
                    const { token } = await pow.ffs.create()
                    console.log("token: " + token)
                    if (token) {
                        // pow.setToken(token)
                        const sql = `insert into user_logininfo values('${username}','${password}','${token}','${email}')`;
                        exec(sql).then((result) => {
                            console.dir("result:" + result)
                            if (result != undefined && result.length != 0) {

                                res.json({
                                    "code": 200,
                                    "msg": "register success!"
                                })
                            }
                            else {
                                res.json({
                                    "code": 500,
                                    "msg": "register failed! Please try again"
                                })
                            }
                            return;
                        });
                    }
                } catch (e) {
                    console.log(e)
                    res.json({
                        "code": 500,
                        "msg": "creating new instance failed! "+e
                    })

                }
            }
        })
    } catch (e) {
        next(e)
    }
})
app.post('/login', async (req, res) => {
    console.log("-------------------------login-----------------------------")

    const { username, password } = req.body;
    // console.log("username:" + username + ",password:" + password);
    //  var exec = func.connectDb();
    const sql = `select *from user_logininfo where username='${username}'`;
    exec(sql).then(async (result) => {
        if (result && result.length != 0) {
            const user = result[0];
            const isPasswordValid = bcrypt.compareSync(password, user.password);
            if (!isPasswordValid) {
                res.json({
                    "code": 422,
                    "msg": "Password error!"
                });
                return;
            }

            //generate AuthToken
            const AuthToken = jwt.sign({ username: user.username }, SECRET, { expiresIn: EXPIRESD });
            console.log("AuthToken:" + AuthToken);

            const currentuser=new User();
            currentuser.setInfo(user.username, user.email, user.token);
            console.dir(currentuser);

            const token = user.token;
            console.log("token:" + token)
            if (token) {
                try {

                    pow.setToken(token);
                    const { info } = await pow.ffs.info()
                    console.dir(info.balancesList)
                    const balancesList = info.balancesList;
                    res.json({
                        "code": 200,
                        "data": { AuthToken, currentuser, balancesList }
                    })
                    return;
                } catch (e) {
                    res.json({
                        "code": 500,
                        "msg": e
                    })
                }


            }

        } else {
            res.json({
                "code": 422,
                "msg": "The user does not exist,Please register first!"
            });
            return;
        }

    });

});

const auth = async (req, res, next) => {

    if (req.headers.authorization == undefined) {
        res.json({
            "code": 422,
            "msg": "TokenExpiredError:no authorization in headers!Maybe you need login first!"
        })
    }
    const AuthToken = req.headers.authorization.split(" ").pop();
    // console.log(AuthToken)

    try {
        const { username } = jwt.verify(AuthToken, SECRET)

    const sql = `select * from user_logininfo where username='${username}'`;
    exec(sql).then((result) => {
        if (result == undefined || result.length == 0) {
            res.json({
                "code": 422,
                "msg": "check authtoken failed"
            })
            return;
        } else {
            next()
        }
    })
    } catch (error) {
        console.log(error)
        res.json({
            "code":422,
            "msg":error
        })
    }
    

}

app.post('/upload', auth, async (req, res, next) => {
    console.log("-------------------------upload-----------------------------")

    //对传过来的req数据进行解析，files中是文件，fields中是一些text数据
    const form = formidable({ multiples: true });
    form.parse(req, async (err, fields, files) => {
        if (err) {
            next(err);
            return;
        }

        console.log(files.file.path);
        //得到文件的路径和姓名，token，描述
        const path = files.file.path;
        const filename = files.file.name;
        var token = fields.token;
        var description = fields.description;
        var abstract = fields.abstract;
        var walletAddr = fields.walletAddr;

        if (token == undefined) {
            res.json({ "code": 422, "msg": "You are not logged in,Please login first" });
            res.redirect("/login");
            return;
        }
        pow.setToken(token);

        const buffer = fs.readFileSync(path)
        // console.log("buffer:" + buffer);
        try {
            const { cid } = await pow.ffs.stage(buffer)
            if (cid != undefined) {
                var sql = `INSERT INTO fileinfo VALUES('${description}','${cid}','${filename}','${abstract}','${walletAddr}',0)`
                exec(sql).then(async (result) => {
                    console.log(result);
                    if (result != undefined && result.length != 0) {
                        //提交订单申请上传到filecoin
                        //const jobId = "02bc66e4-8750-4b48-a478-df31e82be981";
                        try{
                            const { jobId } = await pow.ffs.pushStorageConfig(cid)
                            console.log("jobId:" + jobId)
    
                            if (jobId == undefined) {
                                res.json({
                                    "code": 500,
                                    "msg": "Failed to upload the file!Please try again!"
                                })
                                return;
                            }
                            res.json({ "code": 200, "msg": "upload success!" });
                            return;
                        }catch(e){
                            console.log(e)
                            res.json({
                                "code":422,
                                "msg":e
                            })
                        }
                        
                    } else {
                        res.json({
                            "code": 500,
                            "msg": "Failed to store to database!Maybe the file has been stored already!"
                        })
                        return;
                    }

                })
            } else {
                res.json({
                    "code": 500,
                    "msg": "Failed to upload the file!Please try again!"
                })
                return;
            }

        } catch (e) {
            console.log(e)
            res.json({
                "code": 500,
                "msg": e
            })
            return;
        }


    });
});

app.post('/',async (req,res)=>{
    // console.log("-------------------------------test------------------------------------")
    // const token='615e6738-16ce-4e3e-a181-a289fb955f32';
    // pow.setToken(token);
    // const { jobId } = await pow.ffs.pushStorageConfig('QmYQwQTd6RY1KtuBguHADYroUDgcuCTQmgdLJmQK9y5PbY')
    //                         console.log("jobId:" + jobId)

    // const filename='aaa.pdf'
    // res.download(filename,(err)=>{
    //     console.log(err);
    // })
    // console.log('Your file has been downloaded!')

    const { token } = await pow.ffs.create()
                    console.log("token: " + token)
})

app.post('/retrieve', (req, res) => {
    console.log("-------------------------retrieve-----------------------------")

    console.log(req.body.description);
    const description = req.body.description;
    const type = req.body.type;
    if (description == undefined) {
        res.json({
            "code": 422,
            "msg": "Message format error!"
        });
        return;
    }
    // var sql=new String();
    if (type == 1) {
        var sql = `SELECT cid,filename,abstract,walletAddr,downloads from fileinfo WHERE filename like '%${description}%' or description like '%${description}%' ORDER BY downloads DESC`;
    } else {
        var sql = `SELECT cid,filename,abstract,walletAddr,downloads from fileinfo WHERE description like '%${description}%' ORDER BY downloads DESC`;
    }
    exec(sql).then(async (result) => {
        //get all the cids satisfying the keyword
       // console.dir(result)
        if (result != undefined && result.length != 0) {

            var filelist = new Array();
            result.forEach(async (item, index) => {

                var file = new File();
                file.setInfo(item.cid, item.filename, item.abstract, item.walletAddr, item.downloads)
                filelist.push(file);

                if (filelist.length == result.length) {

                    res.json({ "code": 200, "data": filelist })

                }
            })

        }
        else {
            res.json({
                "code": 422,
                "msg": 'No such paper has been found yet'
            })
        }

    });

})

//点击download，生成文件返给前端
app.post('/retrieve/download', auth, async (req, res) => {
    console.log("-------------------------download-----------------------------")

    var token = req.body.token;
    var cid = req.body.cid;
    var filename = req.body.filename;
    pow.setToken(token)
    try {
        const bytes = await pow.ffs.get(cid)
        fs.writeFile(filename, bytes, "binary", function (err) {
            if (err) {
                console.log(err);
                res.json({
                    "code": 500,
                    "msg": "error!"
                })
            } else {
                // res.download(path.join(__dirname,'/')+filename,(err)=>{
                //     if()
                //     console.log(err);
                // })
                // console.log('Your file has been downloaded!')
                res.sendFile(path.join(__dirname, '/') + filename)
            }
        });

    } catch (e) {
        if(e=="error code 2 - getting cid config: stored item not found"){
            console.log("pushStorageConfig........")
            const sql=`SELECT * FROM fileinfo where cid='${cid}'`;
            exec(sql).then(async (result)=>{
                if(result!=undefined&&result.length!=0){
                    try{
                        const { jobId } = await pow.ffs.pushStorageConfig(cid)
                    }catch(e){
                        res.json({
                            "code":500,
                            "msg":e
                        })
                        return;
                    }
                    const bytes = await pow.ffs.get(cid)
                    fs.writeFile(filename, bytes, "binary", function (err) {
                        if (err) {
                            console.log(err);
                            res.json({
                                "code": 500,
                                "msg": "writeFile error!"+err
                            })
                        } else {
                            // res.download(filename,(err)=>{
                            //     console.log(err);
                            // })
                            // console.log('Your file has been downloaded!')
                            res.sendFile(path.join(__dirname, '/') + filename)
                        }
                    });
                }else{
                    res.json({
                        "code":422,
                        "msg":"cid error!"
                    })
                }
            })
        }else{
            res.json({
                "code": 500,
                "msg": e
            })
            return;
        }
        

    }
})

app.post('/retrieve/download/payment', auth, async (req, res) => {
    console.log("-------------------------payment-----------------------------")

    var from = req.body.from;
    var to = req.body.to;
    var amnt = req.body.amnt;
    var cid = req.body.cid;
    var token = req.body.token;

    
    try {
        pow.setToken(token);
        await pow.ffs.sendFil(from, to, amnt);
        const sql = `UPDATE fileinfo set downloads=downloads+1 where cid='${cid}';`
        exec(sql).then((result) => {
            if (result != undefined && result.length != 0) {
                res.json({
                    "code": 200,
                    "msg": "Send fil successfully!"
                })
            } else {
                res.json({
                    "code": 500,
                    "msg": "FIL send successfully!but record registration failed"
                })
            }
        })
    } catch (e) {
        console.log(e)
        res.json({
            "code": 500,
            "msg": e
        })
    }



})
app.post('/createWallet', auth, async (req, res) => {

    const walletname = req.body.walletname;
    const token = req.body.token;
    const type = req.body.type;
    console.log("token:" + token + "   walletname:" + walletname);
    pow.setToken(token);
    try {
        await pow.ffs.newAddr(walletname, type, false);
        const { info } = await pow.ffs.info()
        const balancesList = info.balancesList;
        
        res.json({
            "code": 200,
            "data": balancesList
        });
    } catch (e) {
        res.json({
            "code": 500,
            "msg": e
        })
    }


})

app.post('/addWallet', auth, (req, res, _) => {

})
