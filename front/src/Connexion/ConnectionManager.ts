import Axios from "axios";
import {API_URL} from "../Enum/EnvironmentVariable";
import {RoomConnection} from "./RoomConnection";
import {PositionInterface, ViewportInterface} from "./ConnexionModels";
import {GameConnexionTypes, urlManager} from "../Url/UrlManager";
import {localUserStore} from "./LocalUserStore";
import {LocalUser} from "./LocalUser";
import {Room} from "./Room";

const URL_ROOM_STARTED = '/Floor0/floor0.json';

class ConnectionManager {
    private localUser!:LocalUser;

    /**
     * Tries to login to the node server and return the starting map url to be loaded
     */
    public async initGameConnexion(): Promise<Room> {

        const connexionType = urlManager.getGameConnexionType();
        if(connexionType === GameConnexionTypes.register) {
           const organizationMemberToken = urlManager.getOrganizationToken();
            const data = await Axios.post(`${API_URL}/register`, {organizationMemberToken}).then(res => res.data);
            this.localUser = new LocalUser(data.userUuid, data.authToken, data.textures);
            localUserStore.saveUser(this.localUser);

            const organizationSlug = data.organizationSlug;
            const worldSlug = data.worldSlug;
            const roomSlug = data.roomSlug;
            urlManager.editUrlForRoom(roomSlug, organizationSlug, worldSlug);

            const room = new Room(window.location.pathname + window.location.hash);
            return Promise.resolve(room);
        } else if (connexionType === GameConnexionTypes.anonymous || connexionType === GameConnexionTypes.empty) {
            const localUser = localUserStore.getLocalUser();

            if (localUser && localUser.jwtToken && localUser.uuid && localUser.textures) {
                this.localUser = localUser;
                try {
                    await this.verifyToken(localUser.jwtToken);
                } catch(e) {
                    // If the token is invalid, let's generate an anonymous one.
                    console.error('JWT token invalid. Did it expire? Login anonymously instead.');
                    await this.anonymousLogin();
                }
            } else {
                await this.anonymousLogin();
            }
            let roomId: string
            if (connexionType === GameConnexionTypes.empty) {
                const defaultMapUrl = window.location.host.replace('play.', 'maps.') + URL_ROOM_STARTED;
                roomId = urlManager.editUrlForRoom(defaultMapUrl, null, null);
            } else {
                roomId = window.location.pathname + window.location.hash;
            }
            const room = new Room(roomId);
            return Promise.resolve(room);
        } else if (connexionType == GameConnexionTypes.organization) {
            const localUser = localUserStore.getLocalUser();

            if (localUser) {
                this.localUser = localUser;
                await this.verifyToken(localUser.jwtToken);
                const room = new Room(window.location.pathname + window.location.hash);
                return Promise.resolve(room);
            } else {
                //todo: find some kind of fallback?
                return Promise.reject('Could not find a user in localstorage');
            }
        }

        return Promise.reject('Invalid URL');
    }

    private async verifyToken(token: string): Promise<void> {
        await Axios.get(`${API_URL}/verify`, {params: {token}});
    }

    public async anonymousLogin(isBenchmark: boolean = false): Promise<void> {
        const data = await Axios.post(`${API_URL}/anonymLogin`).then(res => res.data);
        this.localUser = new LocalUser(data.userUuid, data.authToken, []);
        if (!isBenchmark) { // In benchmark, we don't have a local storage.
            localUserStore.saveUser(this.localUser);
        }
    }

    public initBenchmark(): void {
        this.localUser = new LocalUser('', 'test', []);
    }

    public connectToRoomSocket(roomId: string, name: string, characterLayers: string[], position: PositionInterface, viewport: ViewportInterface): Promise<RoomConnection> {
        return new Promise<RoomConnection>((resolve, reject) => {
            const connection = new RoomConnection(this.localUser.jwtToken, roomId, name, characterLayers, position, viewport);
            connection.onConnectError((error: object) => {
                console.log('An error occurred while connecting to socket server. Retrying');
                reject(error);
            });
            connection.onConnect(() => {
                resolve(connection);
            })
        }).catch((err) => {
            // Let's retry in 4-6 seconds
            return new Promise<RoomConnection>((resolve, reject) => {
                setTimeout(() => {
                    //todo: allow a way to break recurrsion?
                    this.connectToRoomSocket(roomId, name, characterLayers, position, viewport).then((connection) => resolve(connection));
                }, 4000 + Math.floor(Math.random() * 2000) );
            });
        });
    }
}

export const connectionManager = new ConnectionManager();
