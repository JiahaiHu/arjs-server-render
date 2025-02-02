// TODO: Replace with your own channel ID
const drone = new ScaleDrone('GBabGRlxt6FbtG9K');
// Room name needs to be prefixed with 'observable-'
const roomName = 'observable-room';
const configuration = {
  iceServers: [{
    urls: 'stun:stun.l.google.com:19302'
  }]
};
let room;
let pc;
let renderer;
let arToolkitSource;
let onRenderFcts = []; // array of functions for the rendering loop
let sendChannel;
let localArWorldRoot;


function onSuccess() {};
function onError(error) {
  console.error(error);
};

drone.on('open', error => {
  if (error) {
    return console.error(error);
  }
  room = drone.subscribe(roomName);
  room.on('open', error => {
    if (error) {
      onError(error);
    }
  });
  // We're connected to the room and received an array of 'members'
  // connected to the room (including us). Signaling server is ready.
  room.on('members', members => {
    console.log('MEMBERS', members);
    // If we are the second user to connect to the room we will be creating the offer
    const isOfferer = members.length === 2;
    initAr(isOfferer);
    startWebRTC(isOfferer);
  });
});

// Send signaling data via Scaledrone
function sendMessage(message) {
  drone.publish({
    room: roomName,
    message
  });
}

function initAr(isOfferer) {
  var isClient = !isOfferer;

  //////////////////////////////////////////////////////////////////////////////////
	//		Init
  //////////////////////////////////////////////////////////////////////////////////
  
  // init renderer
  renderer = new THREE.WebGLRenderer({
    // antialias	: true,
    alpha: true
  });
  renderer.setClearColor(new THREE.Color('lightgrey'), 0)
  // renderer.setPixelRatio( 1/2 );
  renderer.setSize( 640, 480 );
  renderer.domElement.style.position = 'absolute';
	renderer.domElement.style.top = '0px';
	renderer.domElement.style.left = '0px';
  document.body.appendChild( renderer.domElement );

	// init scene and camera
  var scene	= new THREE.Scene();
  var camera = new THREE.Camera();
	scene.add(camera);

  ////////////////////////////////////////////////////////////////////////////////
	//          initialize arToolkitContext
	////////////////////////////////////////////////////////////////////////////////

	// create atToolkitContext
	var arToolkitContext = new THREEx.ArToolkitContext({
		cameraParametersUrl: THREEx.ArToolkitContext.baseURL + '../data/camera_para.dat',
		detectionMode: 'mono',
		maxDetectionRate: 30,
		canvasWidth: 80*3,
		canvasHeight: 60*3,
	})
	// initialize it
	arToolkitContext.init(function onCompleted(){
		// copy projection matrix to camera
		camera.projectionMatrix.copy( arToolkitContext.getProjectionMatrix() );
  })

  if (!isClient) {
    // update artoolkit on every frame
    onRenderFcts.push(function(){
      if (arToolkitSource === undefined) return;
      if( arToolkitSource.ready === false )	return;

      arToolkitContext.update( arToolkitSource.domElement );
    });
  }

  ////////////////////////////////////////////////////////////////////////////////
  //          Create a ArMarkerControls
  ////////////////////////////////////////////////////////////////////////////////

  var arWorldRoot;

  if (!isClient) {
    var markerRoot = new THREE.Group
    scene.add(markerRoot)
    var artoolkitMarker = new THREEx.ArMarkerControls(arToolkitContext, markerRoot, {
      type : 'pattern',
      patternUrl : THREEx.ArToolkitContext.baseURL + '../data/patt.hiro'
      // patternUrl : THREEx.ArToolkitContext.baseURL + '../data/patt.kanji'
    })

    // build a smoothedControls
    var smoothedRoot = new THREE.Group()
    scene.add(smoothedRoot)
    var smoothedControls = new THREEx.ArSmoothedControls(smoothedRoot, {
      lerpPosition: 0.4,
      lerpQuaternion: 0.3,
      lerpScale: 1,
    })

    onRenderFcts.push(function(delta){
      smoothedControls.update(markerRoot);
      
      if (sendChannel.readyState == "open") {
        var obj = {
          visible: smoothedRoot.visible,
          position: smoothedRoot.position,
          quaternion: smoothedRoot.quaternion,
          scale: smoothedRoot.scale,
        }
        sendChannel.send(JSON.stringify(obj));
      }
    })

    arWorldRoot = smoothedRoot;
  } else {
    localArWorldRoot = new THREE.Group();
    scene.add(localArWorldRoot);
    localArWorldRoot.matrixAutoUpdate = false;
    localArWorldRoot.visible = false;

    arWorldRoot = localArWorldRoot;
  }

  //////////////////////////////////////////////////////////////////////////////////
	//		add an object in the scene
	//////////////////////////////////////////////////////////////////////////////////

	// add a torus knot
	var geometry	= new THREE.BoxGeometry(1,1,1);
	var material	= new THREE.MeshNormalMaterial({
		transparent : true,
		opacity: 0.5,
		side: THREE.DoubleSide
	});
	var mesh	= new THREE.Mesh( geometry, material );
	mesh.position.y	= geometry.parameters.height/2
	arWorldRoot.add( mesh );

	var geometry	= new THREE.TorusKnotGeometry(0.3,0.1,64,16);
	var material	= new THREE.MeshNormalMaterial();
	var mesh	= new THREE.Mesh( geometry, material );
	mesh.position.y	= 0.5
	arWorldRoot.add( mesh );

	onRenderFcts.push(function(){
		mesh.rotation.x += 0.1
  })
  
  //////////////////////////////////////////////////////////////////////////////////
	//		render the whole thing on the page
  //////////////////////////////////////////////////////////////////////////////////
  if (isClient) {
    var stats = new Stats();
    document.body.appendChild( stats.dom );
    // render the scene
    onRenderFcts.push(function(){
      renderer.render( scene, camera );
      stats.update();
    })
  }

  // run the rendering loop
  var lastTimeMsec= null
  requestAnimationFrame(function animate(nowMsec){
    // keep looping
    requestAnimationFrame( animate );
    // measure time
    lastTimeMsec	= lastTimeMsec || nowMsec-1000/60
    var deltaMsec	= Math.min(200, nowMsec - lastTimeMsec)
    lastTimeMsec	= nowMsec
    // call each update function
    onRenderFcts.forEach(function(onRenderFct){
      onRenderFct(deltaMsec/1000, nowMsec/1000)
    })
  })
}

function startWebRTC(isOfferer) {
  pc = new RTCPeerConnection(configuration);

  if (isOfferer) {
    sendChannel = pc.createDataChannel('sendDataChannel');
    sendChannel.onopen = function(event) {
      if (sendChannel.readyState == "open") {
        console.log("sendChannel is opened!");
      }
    };
  } else {
    pc.ondatachannel = event => {
      event.channel.onmessage = e => {
        var obj = JSON.parse(e.data);
        updateLocalSmoothedObject3d(obj);
      }
    }
  }

  // 'onicecandidate' notifies us whenever an ICE agent needs to deliver a
  // message to the other peer through the signaling server
  pc.onicecandidate = event => {
    if (event.candidate) {
      sendMessage({'candidate': event.candidate});
    }
  };

  // If user is offerer let the 'negotiationneeded' event create the offer
  if (isOfferer) {
    // only receive stream
    var offerOptions = {
      offerToReceiveVideo: true,
      offerToReceiveAudio: true,
    };
    pc.onnegotiationneeded = () => {
      pc.createOffer(offerOptions).then(localDescCreated).catch(onError);
    }
  }

  var isClient = !isOfferer;

  // When a remote stream arrives display it in the #remoteVideo element
  pc.ontrack = event => {
    const stream = event.streams[0];
    
    if (!isClient) {
      initArToolkitSource(stream);
    }
  }

  if (isClient) {  // local peer (client)
    // webcam stream
    navigator.mediaDevices.getUserMedia({ // require HTTPS
      audio: false,
      video: true,
    }).then(stream => {
      // Display webcam video
      var webcam = document.createElement('video');
      webcam.setAttribute('autoplay', '');
      webcam.setAttribute('muted', '');
      webcam.setAttribute('playsinline', '');
      webcam.srcObject = stream;
      document.body.appendChild(webcam);
      // Add your stream to be sent to the conneting peer
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }, onError);
  }

  // Listen to signaling data from Scaledrone
  room.on('data', (message, client) => {
    // Message was sent by us
    if (client.id === drone.clientId) {
      return;
    }

    if (message.sdp) {
      // This is called after receiving an offer or answer from another peer
      pc.setRemoteDescription(new RTCSessionDescription(message.sdp), () => {
        // When receiving an offer lets answer it
        if (pc.remoteDescription.type === 'offer') {
          pc.createAnswer().then(localDescCreated).catch(onError);
        }
      }, onError);
    } else if (message.candidate) {
      // Add the new ICE candidate to our connections remote description
      pc.addIceCandidate(
        new RTCIceCandidate(message.candidate), onSuccess, onError
      );
    }
  });
}

function localDescCreated(desc) {
  pc.setLocalDescription(
    desc,
    () => sendMessage({'sdp': pc.localDescription}),
    onError
  );
}

function updateLocalSmoothedObject3d(obj) {
  localArWorldRoot.visible = obj.visible;
  localArWorldRoot.position.copy( obj.position );
  localArWorldRoot.scale.copy( obj.scale );
  // TOFIX: quaternion undefined after copy
  // localArWorldRoot.quaternion.copy( obj.quaternion );
  localArWorldRoot.quaternion._w = obj.quaternion._w;
  localArWorldRoot.quaternion._x = obj.quaternion._x;
  localArWorldRoot.quaternion._y = obj.quaternion._y;
  localArWorldRoot.quaternion._z = obj.quaternion._z;

  localArWorldRoot.updateMatrix();
}

function initArToolkitSource(stream) {

  ////////////////////////////////////////////////////////////////////////////////
	//          handle arToolkitSource
	////////////////////////////////////////////////////////////////////////////////

	arToolkitSource = new THREEx.ArToolkitSource({
    sourceType : 'webrtc',
    stream: stream,
	})

	arToolkitSource.init()

}
